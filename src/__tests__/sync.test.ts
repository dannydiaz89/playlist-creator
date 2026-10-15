import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncApproved, type SyncSong, type SyncDeps } from '@/lib/sync';
import { PROVIDERS, QuotaExceededError } from '@/lib/providers';

function song(over: Partial<SyncSong> & { _id: string }): SyncSong {
  return {
    title: 'T', artist: 'A', isrc: 'ISRC001', durationSec: 200,
    playlistTarget: 'Study', source: 'catalog', ...over,
  };
}

function deps(cached: Record<string, any> = {}): SyncDeps & { saved: any[]; marked: string[][] } {
  const saved: any[] = [];
  const marked: string[][] = [];
  return {
    saved, marked,
    getCached: vi.fn(async (isrc, p) => cached[`${isrc}:${p}`] ?? null),
    saveCached: vi.fn(async (isrc, p, r) => { saved.push({ isrc, p, r }); }),
    markSynced: vi.fn(async (ids) => { marked.push(ids); }),
  };
}

let resolveTrack: any, addTracks: any, getPlaylistTrackIds: any;

beforeEach(() => {
  resolveTrack = vi.fn(async (_t: string, q: any) => ({
    providerTrackId: `vid:${q.isrc ?? q.title}`, title: q.title,
    durationSec: q.durationSec, confidence: 'fuzzy' as const,
  }));
  addTracks = vi.fn(async () => {});
  getPlaylistTrackIds = vi.fn(async () => new Set<string>());
  PROVIDERS.youtube.resolveTrack = resolveTrack;
  PROVIDERS.youtube.addTracks = addTracks;
  PROVIDERS.youtube.getPlaylistTrackIds = getPlaylistTrackIds;
});

const targets = new Map([['Study', 'PL1']]);

describe('dedupe', () => {
  it('collapses 12 students picking the same track into one lookup and one insert', async () => {
    const songs = Array.from({ length: 12 }, (_, i) => song({ _id: `s${i}` }));
    const d = deps();
    const out = await syncApproved({ provider: 'youtube', token: 't', songs, targets, deps: d });

    expect(resolveTrack).toHaveBeenCalledTimes(1);
    expect(addTracks).toHaveBeenCalledTimes(1);
    expect(out.totalAdded).toBe(1);
    expect(out.groups[0].skippedDuplicates).toBe(11);
    // All 12 rows still get marked synced, not just the one that was written.
    expect(d.marked.flat()).toHaveLength(12);
  });

  it('does not collapse distinct ISRCs', async () => {
    const songs = [song({ _id: 'a', isrc: 'X1' }), song({ _id: 'b', isrc: 'X2' })];
    await syncApproved({ provider: 'youtube', token: 't', songs, targets, deps: deps() });
    expect(resolveTrack).toHaveBeenCalledTimes(2);
  });

  it('keys manual rows individually — they have no ISRC to dedupe on', async () => {
    const songs = [
      song({ _id: 'm1', isrc: null, source: 'manual' }),
      song({ _id: 'm2', isrc: null, source: 'manual' }),
    ];
    await syncApproved({ provider: 'youtube', token: 't', songs, targets, deps: deps() });
    expect(resolveTrack).toHaveBeenCalledTimes(2);
  });
});

describe('resolution cache', () => {
  it('a cache hit issues no provider lookup at all', async () => {
    const d = deps({
      'ISRC001:youtube': { providerTrackId: 'vid:cached', title: 'T', durationSec: 200, confidence: 'fuzzy' },
    });
    await syncApproved({ provider: 'youtube', token: 't', songs: [song({ _id: 'a' })], targets, deps: d });
    expect(resolveTrack).not.toHaveBeenCalled();   // 0 search units
    expect(addTracks).toHaveBeenCalledWith('t', 'PL1', ['vid:cached']);
  });

  it('writes the cache on a miss', async () => {
    const d = deps();
    await syncApproved({ provider: 'youtube', token: 't', songs: [song({ _id: 'a' })], targets, deps: d });
    expect(d.saved).toHaveLength(1);
    expect(d.saved[0].isrc).toBe('ISRC001');
  });

  it('never caches manual rows', async () => {
    const d = deps();
    await syncApproved({
      provider: 'youtube', token: 't',
      songs: [song({ _id: 'm', isrc: null, source: 'manual' })], targets, deps: d,
    });
    expect(d.saved).toHaveLength(0);
  });
});

describe('idempotency', () => {
  it('skips tracks already in the playlist', async () => {
    getPlaylistTrackIds = vi.fn(async () => new Set(['vid:ISRC001']));
    PROVIDERS.youtube.getPlaylistTrackIds = getPlaylistTrackIds;
    const out = await syncApproved({
      provider: 'youtube', token: 't', songs: [song({ _id: 'a' })], targets, deps: deps(),
    });
    expect(addTracks).not.toHaveBeenCalled();
    expect(out.totalAdded).toBe(0);
  });
});

describe('quota exhaustion', () => {
  it('stops, keeps what was written, and reports honestly', async () => {
    let calls = 0;
    PROVIDERS.youtube.addTracks = vi.fn(async () => {
      if (++calls > 2) throw new QuotaExceededError();
    });
    const songs = Array.from({ length: 6 }, (_, i) => song({ _id: `s${i}`, isrc: `X${i}` }));
    const d = deps();
    const out = await syncApproved({ provider: 'youtube', token: 't', songs, targets, deps: d });

    expect(out.quotaExhausted).toBe(true);
    expect(out.totalAdded).toBe(2);
    expect(d.marked.flat()).toHaveLength(2);            // only what actually landed
    expect(out.message).toMatch(/quota ran out/i);
    expect(out.message).not.toMatch(/^6 tracks synced/); // never claims full success
  });
});

describe('multi-playlist grouping', () => {
  it('writes each playlist target separately', async () => {
    const songs = [
      song({ _id: 'a', isrc: 'X1', playlistTarget: 'Study' }),
      song({ _id: 'b', isrc: 'X2', playlistTarget: 'Energy' }),
    ];
    const out = await syncApproved({
      provider: 'youtube', token: 't', songs,
      targets: new Map([['Study', 'PL1'], ['Energy', 'PL2']]), deps: deps(),
    });
    expect(out.groups).toHaveLength(2);
    expect(addTracks).toHaveBeenCalledWith('t', 'PL1', ['vid:X1']);
    expect(addTracks).toHaveBeenCalledWith('t', 'PL2', ['vid:X2']);
  });
});
