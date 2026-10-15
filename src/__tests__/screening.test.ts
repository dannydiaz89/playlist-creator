import { describe, it, expect } from 'vitest';
import { screenTrack, matchLexicon } from '@convex/lib/screening';

describe('screenTrack', () => {
  it('flags a track the label marked explicit', () => {
    const r = screenTrack({ title: 'rockstar', artist: 'Post Malone', isExplicit: true });
    expect(r.status).toBe('flagged');
    expect(r.isExplicitTag).toBe(true);
  });

  it('passes a clean track', () => {
    const r = screenTrack({ title: 'Here Comes the Sun', artist: 'The Beatles', isExplicit: false });
    expect(r.status).toBe('clean');
    expect(r.matchedKeywords).toEqual([]);
  });

  it('flags on keyword even when the label says clean', () => {
    // The case that justifies keeping the lexicon: explicit_lyrics is false.
    const r = screenTrack({ title: 'Pumped Up Kicks', artist: 'Foster the People', isExplicit: false });
    expect(r.status).toBe('flagged');
    expect(r.isExplicitTag).toBe(false);
    expect(r.matchedKeywords.length).toBeGreaterThan(0);
  });

  it('is false-positive safe: phrase-level, not substring', () => {
    expect(matchLexicon('Hugs Not Drugs', 'PSA Band')).toEqual([]);
    expect(matchLexicon('Begun Again', 'Someone')).toEqual([]);   // "gun" inside "Begun"
    expect(matchLexicon('Killarney Road', 'Trad')).toEqual([]);   // "kill" inside "Killarney"
  });

  it('matches whole words only', () => {
    expect(matchLexicon('Smoking Gun', 'Someone').length).toBeGreaterThan(0);
  });

  it('handles empty and whitespace input without throwing', () => {
    expect(screenTrack({ title: '', artist: '' }).status).toBe('clean');
    expect(screenTrack({ title: '   ', artist: '  ' }).matchedKeywords).toEqual([]);
  });

  describe('manual rows', () => {
    it('is unverified, never clean', () => {
      // The absence of an explicit flag carries NO information here.
      const r = screenTrack({ title: 'Our Concert', artist: 'School Band', source: 'manual' });
      expect(r.status).toBe('unverified');
      expect(r.status).not.toBe('clean');
      expect(r.isExplicitTag).toBe(false);
    });

    it('stays unverified even if isExplicit is falsely passed as false', () => {
      const r = screenTrack({ title: 'x', artist: 'y', isExplicit: false, source: 'manual' });
      expect(r.status).toBe('unverified');
    });

    it('still records keyword matches for the teacher', () => {
      const r = screenTrack({ title: 'Smoking Gun', artist: 'Band', source: 'manual' });
      expect(r.status).toBe('unverified');
      expect(r.matchedKeywords.length).toBeGreaterThan(0);
    });
  });
});
