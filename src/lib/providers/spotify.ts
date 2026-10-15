import {
  MusicProvider, ProviderPlaylist, ResolvedTrack, TrackQuery, PlaylistTrack,
  ProviderAuthError, QuotaExceededError,
} from './types';

const API = 'https://api.spotify.com/v1';

async function call(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) throw new ProviderAuthError('Spotify session expired — reconnect');
  if (res.status === 429) throw new QuotaExceededError('Spotify rate limit hit — retry shortly');
  if (!res.ok) throw new Error(`Spotify ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : await res.json();
}

/**
 * Track count lives in `items.total` on /me/playlists; older responses (and
 * /playlists/{id}) use `tracks.total`. Accept either and fall back to null
 * rather than rendering "(null) tracks".
 */
function playlistTrackCount(p: any): number | null {
  const n = p?.items?.total ?? p?.tracks?.total;
  return typeof n === 'number' ? n : null;
}

export const spotifyProvider: MusicProvider = {
  name: 'spotify',
  displayName: 'Spotify',
  matchConfidence: 'exact',

  async listPlaylists(token) {
    // /me/playlists returns followed playlists too, and those cannot be read or
    // written. Compare owner ids so the UI can rule them out up front.
    const [me, data] = await Promise.all([
      call(token, '/me'),
      call(token, '/me/playlists?limit=50'),
    ]);
    return (data.items ?? []).map(
      (p: any): ProviderPlaylist => ({
        id: p.id,
        name: p.name,
        url: p.external_urls?.spotify ?? '',
        trackCount: playlistTrackCount(p),
        isOwned: p.owner?.id === me.id,
      }),
    );
  },

  async createPlaylist(token, name, description) {
    // POST /me/playlists, NOT /users/{id}/playlists. Spotify removed the latter
    // in its February 2026 Web API migration; it now returns 403 Forbidden for
    // every caller on a Development Mode app, with correct scopes and all.
    const p = await call(token, '/me/playlists', {
      method: 'POST',
      body: JSON.stringify({ name, description: description ?? '', public: false }),
    });
    return {
      id: p.id,
      name: p.name,
      url: p.external_urls?.spotify ?? '',
      trackCount: playlistTrackCount(p) ?? 0,
      isOwned: true, // just created it
    };
  },

  async resolveTrack(token, q: TrackQuery): Promise<ResolvedTrack | null> {
    // ISRC search is exact. It must be uppercase with no dashes, and results
    // are market-specific, so always pass a market.
    if (q.isrc) {
      const isrc = q.isrc.toUpperCase().replace(/-/g, '');
      const data = await call(
        token,
        `/search?q=${encodeURIComponent(`isrc:${isrc}`)}&type=track&limit=1&market=from_token`,
      );
      const hit = data.tracks?.items?.[0];
      if (hit) {
        return {
          providerTrackId: hit.uri,
          title: hit.name,
          durationSec: Math.round((hit.duration_ms ?? 0) / 1000),
          confidence: 'exact',
        };
      }
    }
    // Fall back to text search when the ISRC is absent or unknown to Spotify.
    const term = `track:${q.title} artist:${q.artist}`;
    const data = await call(
      token,
      `/search?q=${encodeURIComponent(term)}&type=track&limit=1&market=from_token`,
    );
    const hit = data.tracks?.items?.[0];
    if (!hit) return null;
    return {
      providerTrackId: hit.uri,
      title: hit.name,
      durationSec: Math.round((hit.duration_ms ?? 0) / 1000),
      confidence: 'fuzzy',
    };
  },

  async addTracks(token, playlistId, trackIds) {
    // `/items`, NOT `/tracks`. The Feb 2026 Web API migration retired
    // `/playlists/{id}/tracks`; it now returns 403 Forbidden with valid scopes.
    // Spotify accepts up to 100 URIs per request.
    for (let i = 0; i < trackIds.length; i += 100) {
      await call(token, `/playlists/${playlistId}/items`, {
        method: 'POST',
        body: JSON.stringify({ uris: trackIds.slice(i, i + 100) }),
      });
    }
  },

  async listTracks(token, playlistId, limit = 100): Promise<PlaylistTrack[]> {
    const out: PlaylistTrack[] = [];
    let url: string | null = `/playlists/${playlistId}/items?limit=50`;
    while (url && out.length < limit) {
      const data: any = await call(token, url);
      for (const row of data.items ?? []) {
        // `item` on the current shape, `track` on the classic one.
        const t = row?.item ?? row?.track;
        if (!t?.uri) continue;
        out.push({
          providerTrackId: t.uri,
          title: t.name ?? '(unknown)',
          artist: (t.artists ?? []).map((a: any) => a.name).join(', '),
          durationSec: t.duration_ms ? Math.round(t.duration_ms / 1000) : null,
          artworkUrl: t.album?.images?.[t.album.images.length - 1]?.url ?? null,
          addedAt: row.added_at ?? null,
        });
      }
      url = data.next ? data.next.replace(API, '') : null;
    }
    return out.slice(0, limit);
  },

  async removeTracks(token, playlistId, refs) {
    // `/items` with an `items` array. The old `/tracks` path 404s/403s, and
    // `{tracks:[…]}` or `{uris:[…]}` both fail with a misleading
    // "No uris provided" — the field it wants is `items`.
    for (let i = 0; i < refs.length; i += 100) {
      await call(token, `/playlists/${playlistId}/items`, {
        method: 'DELETE',
        body: JSON.stringify({ items: refs.slice(i, i + 100).map((uri) => ({ uri })) }),
      });
    }
  },

  async getPlaylistTrackIds(token, playlistId) {
    const ids = new Set<string>();
    // Also `/items` — the `/tracks` read endpoint returns 403 as of Feb 2026.
    let url: string | null = `/playlists/${playlistId}/items?limit=100`;
    while (url) {
      const data: any = await call(token, url);
      for (const item of data.items ?? []) {
        // `item` on the current shape, `track` on the classic one.
        const uri = item?.item?.uri ?? item?.track?.uri;
        if (uri) ids.add(uri);
      }
      url = data.next ? data.next.replace(API, '') : null;
    }
    return ids;
  },
};
