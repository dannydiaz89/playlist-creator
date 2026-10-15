import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Every component imports its classes from here so a token change propagates
 * everywhere. Mirrors docs/assets/design.css.
 *
 * Sizing rules that are NOT optional:
 *   - 12px (text-xs) is the floor, and only for badges/overlines.
 *   - Table cells and body copy are 14px (text-sm) or larger.
 *   - Every control is min-h-[44px] for the touch-target baseline.
 */
const btnBase =
  'inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 rounded-lg ' +
  'text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2';

export const btn = {
  primary: cn(btnBase, 'bg-accent text-white hover:bg-accent-hover'),
  secondary: cn(btnBase, 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'),
  danger: cn(btnBase, 'bg-bad text-white hover:bg-rose-700'),
  ghost: cn(btnBase, 'text-accent hover:bg-indigo-50'),
  // Compact variants keep the 44px target via padding on the parent row.
  ghostSm: 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-accent hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
};

export const input = {
  base:
    'w-full min-h-[44px] px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-sm ' +
    'text-ink placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent ' +
    'focus:border-accent aria-[invalid=true]:border-bad',
};

export const panel = 'bg-white border border-rule rounded-xl';

const badgeBase =
  'inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium leading-relaxed whitespace-nowrap';

export const badge = {
  clean: cn(badgeBase, 'bg-emerald-50 text-emerald-700 border border-emerald-200'),
  flagged: cn(badgeBase, 'bg-amber-50 text-warn border border-amber-200'),
  denied: cn(badgeBase, 'bg-rose-50 text-rose-700 border border-rose-200'),
  pending: cn(badgeBase, 'bg-slate-100 text-slate-600 border border-slate-200'),
  unverified: cn(badgeBase, 'bg-indigo-50 text-indigo-700 border border-indigo-200'),
  code: cn(badgeBase, 'bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono font-semibold'),
};

/** Maps a preScreen status straight to its badge. */
export const statusBadge = {
  clean: badge.clean,
  flagged: badge.flagged,
  unverified: badge.unverified,
} as const;

export const table = {
  root: 'w-full border-collapse text-sm text-left',
  th: 'bg-canvas border-b border-rule px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-600',
  td: 'px-4 py-3.5 border-b border-slate-100 align-top',
};

export const layout = {
  reading: 'w-full max-w-3xl mx-auto px-4 sm:px-6', // forms and prose
  wide: 'w-full max-w-6xl mx-auto px-4 sm:px-6',    // tables need the room
};

/**
 * Album artwork. `object-cover` plus a pinned box so a flex parent cannot
 * stretch it — the default `align-items: stretch` distorts an image in any row
 * taller than the artwork, which is easy to reintroduce by accident.
 */
export const artwork = {
  sm: 'w-9 h-9 rounded shrink-0 object-cover bg-slate-100',
  md: 'w-10 h-10 rounded shrink-0 object-cover bg-slate-100',
  lg: 'w-12 h-12 rounded shrink-0 object-cover bg-slate-100',
};

export const srOnly = 'sr-only';
