import { describe, it, expect } from 'vitest';

/**
 * The dedupe key used by BOTH the sync engine and the sync preview.
 * Kept in one place because the preview must show the plan, not an estimate,
 * and because resolving a track has to cover every row sharing a key.
 */
function dedupeKey(s: { providerTrackId?: string | null; isrc: string | null; _id: string }) {
  return s.providerTrackId ?? s.isrc ?? `manual:${s._id}`;
}

function groupByKey<T extends { providerTrackId?: string | null; isrc: string | null; _id: string }>(
  songs: T[],
): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const s of songs) {
    const k = dedupeKey(s);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(s);
  }
  return m;
}

const song = (id: string, over: Partial<{ isrc: string | null; providerTrackId: string | null }> = {}) =>
  ({ _id: id, isrc: 'ISRC1', providerTrackId: null, ...over });

describe('dedupe grouping', () => {
  it('groups rows two students picked into one entry', () => {
    const g = groupByKey([song('a'), song('b')]);
    expect(g.size).toBe(1);
    expect([...g.values()][0]).toHaveLength(2);
  });

  it('keeps EVERY row in the group, not just the first', () => {
    // The bug: only the group's representative was resolved, so the other
    // student's row stayed unmatched.
    const g = groupByKey([song('a'), song('b'), song('c')]);
    expect([...g.values()][0].map((s) => s._id)).toEqual(['a', 'b', 'c']);
  });

  it('resolving the whole group keeps it as ONE track', () => {
    const rows = [song('a'), song('b')];
    // Simulate the fixed mutation: patch every id in the group.
    const resolved = rows.map((r) => ({ ...r, providerTrackId: 'spotify:track:X' }));
    expect(groupByKey(resolved).size).toBe(1);
  });

  it('resolving only ONE row splits the group — the duplicate bug', () => {
    const rows = [song('a'), song('b')];
    const half = [{ ...rows[0], providerTrackId: 'spotify:track:X' }, rows[1]];
    // Two keys means two writes: the same song added twice.
    expect(groupByKey(half).size).toBe(2);
  });

  it('an exact provider id takes precedence over ISRC as the key', () => {
    expect(dedupeKey(song('a', { providerTrackId: 'spotify:track:X' }))).toBe('spotify:track:X');
  });

  it('manual rows key individually — they share no identifier', () => {
    const g = groupByKey([
      song('m1', { isrc: null }),
      song('m2', { isrc: null }),
    ]);
    expect(g.size).toBe(2);
  });
});
