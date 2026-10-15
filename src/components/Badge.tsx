import { badge } from '@/lib/design';
import type { PreScreen } from '@convex/lib/screening';

export function ScreenBadge({ preScreen }: { preScreen: PreScreen }) {
  if (preScreen.status === 'unverified') {
    return <span className={badge.unverified}>Not verified</span>;
  }
  if (preScreen.status === 'flagged') return <span className={badge.flagged}>Flagged</span>;
  return <span className={badge.clean}>No explicit tag</span>;
}

export function screenReasons(preScreen: PreScreen): string {
  const bits: string[] = [];
  if (preScreen.isExplicitTag) bits.push('Marked explicit by the label');
  if (preScreen.matchedKeywords.length) bits.push(preScreen.matchedKeywords.join(', '));
  return bits.join(' · ');
}
