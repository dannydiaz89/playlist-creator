import { getProvider, QuotaExceededError, ProviderAuthError } from '@/lib/providers';
import type { ProviderName, ResolvedTrack } from '@/lib/providers';

export interface SyncSong {
  _id: string;
  title: string;
  artist: string;
  isrc: string | null;
  /** Exact provider URI captured at pick time, when the student searched the
   *  provider's own catalog. Skips resolution entirely. */
  providerTrackId?: string | null;
  durationSec: number | null;
  playlistTarget: string;
  source: 'catalog' | 'manual';
}

export interface SyncDeps {
  getCached(isrc: string, provider: ProviderName): Promise<ResolvedTrack | null>;
  saveCached(isrc: string, provider: ProviderName, r: ResolvedTrack): Promise<void>;
  markSynced(songIds: string[], uri?: string): Promise<void>;
}

export interface SyncGroupResult {
  target: string;
  playlistId: string;
  added: number;
  skippedDuplicates: number;
  /** Genuinely not findable on the provider. */
  unresolved: { title: string; artist: string }[];
  /** Found, but the write failed. A different problem with a different fix —
   *  collapsing the two hides real API errors behind "track not found". */
  failed: { title: string; artist: string; reason: string }[];
}

export interface SyncOutcome {
  groups: SyncGroupResult[];
  totalAdded: number;
  quotaExhausted: boolean;
  message: string;
}

/**
 * Sync approved tracks, grouped by the student's per-song playlist choice.
 *
 * Three things keep this inside YouTube's 10,000 units/day:
 *   1. only approved songs ever reach here;
 *   2. dedupe by ISRC before resolving — 12 students, 1 lookup;
 *   3. the trackResolutions cache — a hit costs 0 search units.
 */
export async function syncApproved(opts: {
  provider: ProviderName;
  token: string;
  songs: SyncSong[];
  targets: Map<string, string>; // playlist label -> providerPlaylistId
  deps: SyncDeps;
}): Promise<SyncOutcome> {
  const provider = getProvider(opts.provider);
  const groups: SyncGroupResult[] = [];
  let totalAdded = 0;
  let quotaExhausted = false;

  for (const [target, playlistId] of opts.targets) {
    const inGroup = opts.songs.filter((s) => s.playlistTarget === target);
    if (!inGroup.length) continue;

    // Dedupe FIRST. Prefer the exact provider URI as the key; manual rows have
    // neither and key on their own id.
    const byKey = new Map<string, SyncSong[]>();
    for (const song of inGroup) {
      const key = song.providerTrackId ?? song.isrc ?? `manual:${song._id}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(song);
    }
    const skippedDuplicates = inGroup.length - byKey.size;

    let existing = new Set<string>();
    try {
      existing = await provider.getPlaylistTrackIds(opts.token, playlistId);
    } catch (err) {
      if (err instanceof QuotaExceededError) { quotaExhausted = true; break; }
      if (err instanceof ProviderAuthError) throw err;
    }

    const result: SyncGroupResult = {
      target, playlistId, added: 0, skippedDuplicates, unresolved: [], failed: [],
    };

    for (const [key, songs] of byKey) {
      const song = songs[0];
      let resolvedOk = false;
      try {
        let resolved: ResolvedTrack | null = null;

        // Picked from this provider's own catalog: the URI is already exact.
        // No search, no ISRC bridge, no fuzzy match, no quota spent.
        if (song.providerTrackId && song.providerTrackId.startsWith(
          opts.provider === 'spotify' ? 'spotify:' : '',
        )) {
          resolved = {
            providerTrackId: song.providerTrackId,
            title: song.title,
            durationSec: song.durationSec,
            confidence: 'exact',
          };
        }
        if (!resolved && song.isrc) {
          resolved = await opts.deps.getCached(song.isrc, opts.provider);
        }
        if (!resolved) {
          resolved = await provider.resolveTrack(opts.token, {
            isrc: song.isrc,
            title: song.title,
            artist: song.artist,
            durationSec: song.durationSec,
          });
          // Manual rows are never cached — no stable key to cache them under.
          if (resolved && song.isrc) {
            await opts.deps.saveCached(song.isrc, opts.provider, resolved);
          }
        }

        if (!resolved) {
          result.unresolved.push({ title: song.title, artist: song.artist });
          continue;
        }
        resolvedOk = true;

        if (existing.has(resolved.providerTrackId)) {
          // Already in the playlist. Mark synced so re-running does not retry.
          await opts.deps.markSynced(songs.map((s) => s._id), resolved.providerTrackId);
          continue;
        }

        await provider.addTracks(opts.token, playlistId, [resolved.providerTrackId]);
        existing.add(resolved.providerTrackId);
        // Mark AFTER the write succeeds, so a mid-batch failure is resumable.
        await opts.deps.markSynced(songs.map((s) => s._id), resolved.providerTrackId);
        result.added++;
        totalAdded++;
      } catch (err) {
        if (err instanceof QuotaExceededError) { quotaExhausted = true; break; }
        if (err instanceof ProviderAuthError) throw err;
        const reason = err instanceof Error ? err.message : String(err);
        if (resolvedOk) result.failed.push({ title: song.title, artist: song.artist, reason });
        else result.unresolved.push({ title: song.title, artist: song.artist });
      }
    }

    groups.push(result);
    if (quotaExhausted) break;
  }

  // Report honestly. A silently half-filled playlist is not discovered until class.
  const failedCount = groups.reduce((n, g) => n + g.failed.length, 0);
  const unresolvedCount = groups.reduce((n, g) => n + g.unresolved.length, 0);
  const firstFailure = groups.flatMap((g) => g.failed)[0];

  let message = quotaExhausted
    ? `${totalAdded} track${totalAdded === 1 ? '' : 's'} synced before the daily ` +
      `${provider.displayName} quota ran out. Those are saved — retry tomorrow for the rest.`
    : `${totalAdded} track${totalAdded === 1 ? '' : 's'} synced to ${provider.displayName}.`;
  if (unresolvedCount) {
    message += ` ${unresolvedCount} not found on ${provider.displayName}.`;
  }
  if (failedCount) {
    // Surface the actual API error; "not found" would send the teacher hunting
    // for a track that was found perfectly well.
    message += ` ${failedCount} could not be added: ${firstFailure?.reason ?? 'unknown error'}`;
  }

  return { groups, totalAdded, quotaExhausted, message };
}
