import { describe, it, expect } from 'vitest';
import { searchCatalog, getCatalogTrack } from '@/lib/catalog';
import { screenTrack } from '@convex/lib/screening';

/**
 * Hits the real Deezer API. Set SKIP_LIVE=1 to skip in offline CI.
 * These exist because the explicit flag is the whole screening signal — if the
 * catalog ever starts filtering explicit tracks the way iTunes does, this fails
 * loudly instead of the app silently marking everything clean.
 */
const live = process.env.SKIP_LIVE ? describe.skip : describe;

live('catalog (live)', () => {
  it('returns an explicit track WITH the explicit flag set', async () => {
    const hits = await searchCatalog('rockstar post malone', 3);
    expect(hits.length).toBeGreaterThan(0);
    const hit = hits.find((h) => /rockstar/i.test(h.title));
    expect(hit).toBeDefined();
    // The regression guard: fails if the catalog starts hiding explicit tracks.
    expect(hit!.isExplicit).toBe(true);
  }, 20000);

  it('returns a clean track with the flag false', async () => {
    const hits = await searchCatalog('here comes the sun beatles', 2);
    expect(hits[0].isExplicit).toBe(false);
  }, 20000);

  it('track detail supplies an uppercase, dash-free ISRC', async () => {
    const hits = await searchCatalog('midnight city m83', 1);
    const full = await getCatalogTrack(hits[0].deezerId);
    expect(full.isrc).toMatch(/^[A-Z0-9]{12}$/); // Spotify's isrc: filter needs this
  }, 20000);

  it('end-to-end: an explicit catalog hit screens as flagged', async () => {
    const hits = await searchCatalog('rockstar post malone', 1);
    const s = screenTrack({ ...hits[0], source: 'catalog' });
    expect(s.status).toBe('flagged');
    expect(s.isExplicitTag).toBe(true);
  }, 20000);

  it('tolerates typos — students misspell constantly', async () => {
    const hits = await searchCatalog('sunflwer post malon', 3);
    expect(hits.length).toBeGreaterThan(0);
  }, 20000);
});
