import { describe, it, expect } from 'vitest';

/**
 * A track can arrive under a Spotify URI (student searched Spotify) or only an
 * ISRC (searched Deezer). A prior denial must be recognised either way, or a
 * rejected song walks back in through the other catalog.
 */
type Row = { providerTrackId?: string | null; isrc?: string | null };

function matchesPriorDenial(song: Row, denied: Row[]): boolean {
  return denied.some(
    (d) =>
      (Boolean(song.providerTrackId) && d.providerTrackId === song.providerTrackId) ||
      (Boolean(song.isrc) && d.isrc === song.isrc),
  );
}

describe('prior denial matching', () => {
  const deniedByUri: Row = { providerTrackId: 'spotify:track:X', isrc: 'ISRC1' };

  it('matches the same provider track id', () => {
    expect(matchesPriorDenial({ providerTrackId: 'spotify:track:X' }, [deniedByUri])).toBe(true);
  });

  it('matches on ISRC when the resubmission came from another catalog', () => {
    expect(matchesPriorDenial({ isrc: 'ISRC1', providerTrackId: null }, [deniedByUri])).toBe(true);
  });

  it('does not match a different track', () => {
    expect(matchesPriorDenial({ providerTrackId: 'spotify:track:Y', isrc: 'ISRC2' }, [deniedByUri]))
      .toBe(false);
  });

  it('null identifiers never match each other', () => {
    // Two manual rows both lacking ids must not be treated as the same song.
    expect(matchesPriorDenial({ providerTrackId: null, isrc: null },
      [{ providerTrackId: null, isrc: null }])).toBe(false);
  });

  it('a denial recorded by ISRC catches a later Spotify-sourced pick', () => {
    const deniedByIsrc: Row = { providerTrackId: null, isrc: 'ISRC9' };
    expect(matchesPriorDenial({ providerTrackId: 'spotify:track:Z', isrc: 'ISRC9' }, [deniedByIsrc]))
      .toBe(true);
  });
});
