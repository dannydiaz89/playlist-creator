/**
 * Provider-neutral music catalog: Deezer's public API.
 *
 * No API key, no OAuth, no client secret. Chosen over the iTunes Search API,
 * which has silently filtered out explicit tracks since Sept 2025 — it reports
 * `trackExplicitness: "cleaned"` for tracks whose explicit original it hides,
 * so it would mark a track clean and then sync the explicit version. A screening
 * signal that fails OPEN is worse than none.
 *
 * Server-side only: api.deezer.com sends no Access-Control-Allow-Origin, and
 * routing through our own endpoint is also where rate limiting lives.
 */

const DEEZER = 'https://api.deezer.com';

export type CatalogSource = 'spotify' | 'deezer';

export interface CatalogTrack {
  deezerId: number;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  artworkUrl: string;
  isExplicit: boolean;
  isrc: string | null;
  /** Exact provider URI. Present only for provider-native results. */
  providerTrackId?: string | null;
}

export class CatalogUnavailableError extends Error {
  constructor(message = 'Music catalog unavailable') {
    super(message);
    this.name = 'CatalogUnavailableError';
  }
}

async function deezer(path: string, timeoutMs = 6000): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${DEEZER}${path}`, { signal: ctl.signal });
    if (!res.ok) throw new CatalogUnavailableError(`Catalog responded ${res.status}`);
    const data = await res.json();
    if (data?.error) throw new CatalogUnavailableError(data.error.message ?? 'Catalog error');
    return data;
  } catch (err) {
    if (err instanceof CatalogUnavailableError) throw err;
    throw new CatalogUnavailableError('Could not reach the music catalog');
  } finally {
    clearTimeout(timer);
  }
}

/** Search does not return ISRC — only /track/{id} does. */
export async function searchCatalog(term: string, limit = 8): Promise<CatalogTrack[]> {
  if (!term.trim()) return [];
  const data = await deezer(`/search?q=${encodeURIComponent(term)}&limit=${limit}`);
  return (data.data ?? []).map(
    (t: any): CatalogTrack => ({
      deezerId: t.id,
      title: t.title,
      artist: t.artist?.name ?? '',
      album: t.album?.title ?? '',
      durationSec: t.duration ?? 0,
      artworkUrl: t.album?.cover_small ?? '',
      isExplicit: Boolean(t.explicit_lyrics),
      isrc: null,
    }),
  );
}

export async function getCatalogTrack(deezerId: number): Promise<CatalogTrack> {
  const t = await deezer(`/track/${deezerId}`);
  return {
    deezerId: t.id,
    title: t.title,
    artist: (t.contributors ?? []).map((c: any) => c.name).join(', ') || t.artist?.name || '',
    album: t.album?.title ?? '',
    durationSec: t.duration ?? 0,
    artworkUrl: t.album?.cover_small ?? '',
    isExplicit: Boolean(t.explicit_lyrics),
    // Spotify's isrc: filter needs uppercase, no dashes.
    isrc: t.isrc ? String(t.isrc).toUpperCase().replace(/-/g, '') : null,
  };
}

// --- Spotify catalog -------------------------------------------------------
/**
 * Search Spotify directly, so a student can only pick tracks that provably
 * exist on the platform the teacher syncs to.
 *
 * This exists because the Deezer -> Spotify bridge is unreliable: the two
 * catalogs assign DIFFERENT ISRCs to the same recording, and Deezer carries
 * tracks Spotify does not. Verified live: a Sublime track picked from Deezer
 * (ISRC USGA19647697) returned zero Spotify results by ISRC *and* by text.
 *
 * Uses client credentials — an app-level token, so students never sign in and
 * the teacher's own token is never spent on student searches.
 */
let ccToken: { value: string; expiresAt: number } | null = null;

async function spotifyAppToken(): Promise<string | null> {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;

  if (ccToken && Date.now() < ccToken.expiresAt - 60_000) return ccToken.value;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.access_token) return null;
  ccToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return ccToken.value;
}

export async function searchSpotifyCatalog(
  term: string,
  limit = 8,
  market = process.env.SPOTIFY_MARKET ?? 'US',
): Promise<CatalogTrack[]> {
  if (!term.trim()) return [];
  const token = await spotifyAppToken();
  if (!token) throw new CatalogUnavailableError('Spotify search is not configured');

  const url =
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(term)}` +
    `&type=track&limit=${limit}&market=${encodeURIComponent(market)}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new CatalogUnavailableError('Could not reach Spotify');
  }
  if (res.status === 401) { ccToken = null; throw new CatalogUnavailableError('Spotify token expired'); }
  if (!res.ok) throw new CatalogUnavailableError(`Spotify search responded ${res.status}`);

  const data = await res.json();
  return (data.tracks?.items ?? []).map(
    (t: any): CatalogTrack => ({
      deezerId: 0, // not a Deezer record
      title: t.name,
      artist: (t.artists ?? []).map((a: any) => a.name).join(', '),
      album: t.album?.name ?? '',
      durationSec: Math.round((t.duration_ms ?? 0) / 1000),
      artworkUrl: t.album?.images?.[t.album.images.length - 1]?.url ?? '',
      isExplicit: Boolean(t.explicit),
      isrc: t.external_ids?.isrc
        ? String(t.external_ids.isrc).toUpperCase().replace(/-/g, '')
        : null,
      // The exact URI. Sync writes this straight in — no lookup, no fuzzy match.
      providerTrackId: t.uri,
    }),
  );
}
