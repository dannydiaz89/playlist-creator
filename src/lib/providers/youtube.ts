import {
  MusicProvider, ProviderPlaylist, ResolvedTrack, TrackQuery, PlaylistTrack,
  ProviderAuthError, QuotaExceededError,
} from './types';

const API = 'https://www.googleapis.com/youtube/v3';

/**
 * Quota costs against a default 10,000 units/day:
 *   search.list           100   <- the expensive one
 *   playlistItems.insert   50
 *   playlists.insert       50
 *   playlists.list          1
 *   playlistItems.list      1
 *
 * Naively 150 units/song = ~66 songs/day, which one class of 30 students
 * exceeds. The caller must dedupe by ISRC and consult the trackResolutions
 * cache before ever calling resolveTrack.
 */
export const QUOTA_COST = {
  search: 100,
  playlistItemsInsert: 50,
  playlistsInsert: 50,
  list: 1,
} as const;

async function call(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) throw new ProviderAuthError('YouTube session expired — reconnect');
  if (res.status === 403) {
    const body = await res.text();
    if (/quotaExceeded|dailyLimitExceeded/i.test(body)) {
      throw new QuotaExceededError(
        'YouTube daily quota exhausted. Approved tracks already added are saved — retry tomorrow.',
      );
    }
    throw new Error(`YouTube 403: ${body}`);
  }
  if (!res.ok) throw new Error(`YouTube ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : await res.json();
}

/** Accept a match only if the duration is within 8s — guards against a
 *  10-minute "extended mix" or a full album upload being inserted. */
function durationOk(expected: number | null, actual: number | null): boolean {
  if (expected === null || actual === null) return true;
  return Math.abs(expected - actual) <= 8;
}

function parseISO8601Duration(iso: string): number | null {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '');
  if (!m) return null;
  return (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0));
}

export const youtubeProvider: MusicProvider = {
  name: 'youtube',
  displayName: 'YouTube Music',
  // No ISRC lookup exists, so every match is text-based. The UI must say so.
  matchConfidence: 'fuzzy',

  async listPlaylists(token) {
    const data = await call(token, '/playlists?part=snippet,contentDetails&mine=true&maxResults=50');
    return (data.items ?? []).map(
      (p: any): ProviderPlaylist => ({
        id: p.id,
        name: p.snippet?.title ?? '(untitled)',
        url: `https://music.youtube.com/playlist?list=${p.id}`,
        trackCount: p.contentDetails?.itemCount ?? null,
        isOwned: true, // `mine=true` only ever returns the user's own playlists
      }),
    );
  },

  async createPlaylist(token, name, description) {
    const p = await call(token, '/playlists?part=snippet,status', {
      method: 'POST',
      body: JSON.stringify({
        snippet: { title: name, description: description ?? '' },
        status: { privacyStatus: 'private' },
      }),
    });
    return {
      id: p.id,
      name: p.snippet?.title ?? name,
      url: `https://music.youtube.com/playlist?list=${p.id}`,
      trackCount: 0,
      isOwned: true,
    };
  },

  async resolveTrack(token, q: TrackQuery): Promise<ResolvedTrack | null> {
    // 100 units. Only ever reached on a cache miss.
    const term = `${q.artist} ${q.title}`;
    const data = await call(
      token,
      `/search?part=snippet&type=video&videoCategoryId=10&maxResults=3&q=${encodeURIComponent(term)}`,
    );
    const items = data.items ?? [];
    if (!items.length) return null;

    const ids = items.map((i: any) => i.id?.videoId).filter(Boolean);
    if (!ids.length) return null;

    // 1 unit — cheap, and it is the only way to duration-check the candidates.
    const details = await call(token, `/videos?part=contentDetails,snippet&id=${ids.join(',')}`);
    for (const video of details.items ?? []) {
      const secs = parseISO8601Duration(video.contentDetails?.duration);
      if (durationOk(q.durationSec, secs)) {
        return {
          providerTrackId: video.id,
          title: video.snippet?.title ?? q.title,
          durationSec: secs,
          confidence: 'fuzzy',
        };
      }
    }
    return null; // every candidate failed the duration check — better than a wrong insert
  },

  async addTracks(token, playlistId, trackIds) {
    // 50 units each, and there is no batch endpoint — one call per track.
    for (const videoId of trackIds) {
      await call(token, '/playlistItems?part=snippet', {
        method: 'POST',
        body: JSON.stringify({
          snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } },
        }),
      });
    }
  },

  async listTracks(token, playlistId, limit = 100): Promise<PlaylistTrack[]> {
    // playlistItems.list is 1 unit, so browsing a playlist is effectively free
    // compared with search.list at 100.
    const out: PlaylistTrack[] = [];
    let pageToken = '';
    do {
      const data: any = await call(
        token,
        `/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=50` +
          (pageToken ? `&pageToken=${pageToken}` : ''),
      );
      for (const row of data.items ?? []) {
        const sn = row.snippet ?? {};
        if (!row.contentDetails?.videoId) continue;
        out.push({
          providerTrackId: row.contentDetails.videoId,
          playlistItemId: row.id,
          title: sn.title ?? '(unknown)',
          artist: sn.videoOwnerChannelTitle ?? sn.channelTitle ?? '',
          durationSec: null, // would need a separate videos.list call
          artworkUrl: sn.thumbnails?.default?.url ?? null,
          addedAt: sn.publishedAt ?? null,
        });
      }
      pageToken = data.nextPageToken ?? '';
    } while (pageToken && out.length < limit);
    return out.slice(0, limit);
  },

  async removeTracks(token, playlistId, refs) {
    // 50 units each. `refs` are playlistItem ids, NOT video ids — deleting by
    // video id silently matches nothing.
    for (const id of refs) {
      await call(token, `/playlistItems?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
  },

  async getPlaylistTrackIds(token, playlistId) {
    const ids = new Set<string>();
    let pageToken = '';
    do {
      const data: any = await call(
        token,
        `/playlistItems?part=contentDetails&playlistId=${playlistId}&maxResults=50` +
          (pageToken ? `&pageToken=${pageToken}` : ''),
      );
      for (const item of data.items ?? []) {
        if (item.contentDetails?.videoId) ids.add(item.contentDetails.videoId);
      }
      pageToken = data.nextPageToken ?? '';
    } while (pageToken);
    return ids;
  },
};
