export type ProviderName = 'spotify' | 'youtube';

export interface ProviderPlaylist {
  id: string;
  name: string;
  url: string;
  trackCount: number | null;
  /**
   * Whether the connected account OWNS this playlist. A followed playlist can
   * be neither read nor written through the API, so offering one to students
   * guarantees every sync into it fails.
   */
  isOwned: boolean;
}

export interface PlaylistTrack {
  providerTrackId: string;
  /** YouTube needs the playlistItem id to delete, which is not the video id. */
  playlistItemId?: string;
  title: string;
  artist: string;
  durationSec: number | null;
  artworkUrl: string | null;
  addedAt: string | null;
}

export interface ResolvedTrack {
  providerTrackId: string;
  title: string;
  durationSec: number | null;
  confidence: 'exact' | 'fuzzy';
}

export interface TrackQuery {
  isrc: string | null;
  title: string;
  artist: string;
  durationSec: number | null;
}

/** Thrown when the provider's daily quota is gone. Must NOT be retried today. */
export class QuotaExceededError extends Error {
  constructor(message = 'Daily API quota exhausted') {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export class ProviderAuthError extends Error {
  constructor(message = 'Provider authorization failed') {
    super(message);
    this.name = 'ProviderAuthError';
  }
}

export interface MusicProvider {
  name: ProviderName;
  displayName: string;
  /** Spotify matches by ISRC (exact); YouTube matches by text (fuzzy). */
  matchConfidence: 'exact' | 'fuzzy';
  listPlaylists(token: string): Promise<ProviderPlaylist[]>;
  createPlaylist(token: string, name: string, description?: string): Promise<ProviderPlaylist>;
  resolveTrack(token: string, query: TrackQuery): Promise<ResolvedTrack | null>;
  addTracks(token: string, playlistId: string, trackIds: string[]): Promise<void>;
  /** `refs` are provider track ids on Spotify, playlistItem ids on YouTube. */
  removeTracks(token: string, playlistId: string, refs: string[]): Promise<void>;
  getPlaylistTrackIds(token: string, playlistId: string): Promise<Set<string>>;
  /** Full track details for showing a playlist's contents. */
  listTracks(token: string, playlistId: string, limit?: number): Promise<PlaylistTrack[]>;
}
