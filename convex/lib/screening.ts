/**
 * Advisory screening. Pure, synchronous, no network.
 *
 * The catalog already returned `explicit_lyrics` at pick time, so there is no
 * background action and no token needed. This ALSO means screening is identical
 * on Spotify and YouTube — it never touches either provider.
 *
 * It reads title, artist and the label's explicit tag. It does NOT read lyrics.
 * Never present it as anything stronger than advisory.
 */

export type ScreenStatus = 'clean' | 'flagged' | 'unverified';

export interface PreScreen {
  status: ScreenStatus;
  isExplicitTag: boolean;
  matchedKeywords: string[];
}

interface LexiconEntry {
  /** Matched as a whole phrase or whole word — never a bare substring. */
  phrase: string;
  reason: string;
  wholeWord?: boolean;
}

/**
 * School-safety lexicon. Phrase-level by design: a substring rule would flag
 * "Hugs Not Drugs" on "drug" and is the classic false-positive generator.
 * Tune this per district — it is advisory input to a human, not a filter.
 */
export const LEXICON: LexiconEntry[] = [
  { phrase: 'pumped up kicks', reason: 'School-safety theme' },
  { phrase: 'gun', reason: 'Weapons reference', wholeWord: true },
  { phrase: 'guns', reason: 'Weapons reference', wholeWord: true },
  { phrase: 'shoot', reason: 'Violence reference', wholeWord: true },
  { phrase: 'shooter', reason: 'Violence reference', wholeWord: true },
  { phrase: 'kill', reason: 'Violence reference', wholeWord: true },
  { phrase: 'suicide', reason: 'Self-harm reference', wholeWord: true },
  { phrase: 'overdose', reason: 'Substance reference', wholeWord: true },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchLexicon(title: string, artist: string): string[] {
  const hay = `${title ?? ''} ${artist ?? ''}`.toLowerCase().trim();
  if (!hay) return [];
  const reasons = new Set<string>();
  for (const entry of LEXICON) {
    const p = escapeRegExp(entry.phrase);
    const re = entry.wholeWord ? new RegExp(`\\b${p}\\b`) : new RegExp(p);
    if (re.test(hay)) reasons.add(entry.reason);
  }
  return [...reasons];
}

export function screenTrack(input: {
  title: string;
  artist: string;
  isExplicit?: boolean;
  source?: 'catalog' | 'manual';
}): PreScreen {
  const matchedKeywords = matchLexicon(input.title, input.artist);

  // A manual row has no label explicit flag, so the ABSENCE of one carries no
  // information. It gets its own status and must never be bulk-approved as
  // clean — defaulting an unscreened row to clean is a fail-open bug.
  if (input.source === 'manual') {
    return { status: 'unverified', isExplicitTag: false, matchedKeywords };
  }

  const isExplicitTag = Boolean(input.isExplicit);
  return {
    status: isExplicitTag || matchedKeywords.length > 0 ? 'flagged' : 'clean',
    isExplicitTag,
    matchedKeywords,
  };
}
