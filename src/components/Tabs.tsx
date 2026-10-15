'use client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useRef } from 'react';
import { cn } from '@/lib/design';

export interface TabDef { id: string; label: string }

/** The dashboard's tabs. Shared by the layout and the page. */
export const DASHBOARD_TABS: TabDef[] = [
  { id: 'surveys', label: 'Surveys' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'settings', label: 'Settings' },
];

/**
 * Dashboard tabs, rendered from the /teacher layout so they persist into
 * sub-routes (a survey's responses, a single submission). Without that the
 * shell disappears on navigation and it reads as leaving the app.
 *
 * Implements the ARIA tabs pattern — roving tabindex plus arrow keys — which a
 * row of plain links does not give you.
 */
export function Tabs({ tabs }: { tabs: TabDef[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const listRef = useRef<HTMLDivElement>(null);

  // Sub-routes live under the Surveys tab, so it stays marked current there.
  const onSubRoute = pathname.startsWith('/teacher/');
  const requested = onSubRoute ? 'surveys' : (params.get('tab') ?? tabs[0].id);
  const current = tabs.some((t) => t.id === requested) ? requested : tabs[0].id;

  function select(id: string) {
    const href = id === tabs[0].id ? '/teacher' : `/teacher?tab=${id}`;
    // push from a sub-route so Back still works; replace when only swapping tabs.
    if (onSubRoute) router.push(href);
    else router.replace(href, { scroll: false });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const i = tabs.findIndex((t) => t.id === current);
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    select(tabs[next].id);
    listRef.current?.querySelectorAll<HTMLElement>('[role=tab]')[next]?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Dashboard sections"
      onKeyDown={onKeyDown}
      className="flex gap-1 border-b border-rule"
    >
      {tabs.map((t) => {
        const active = t.id === current;
        return (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active}
            aria-controls="tab-panel"
            tabIndex={active ? 0 : -1}
            onClick={() => select(t.id)}
            className={cn(
              'min-h-[44px] px-4 text-sm font-medium border-b-2 -mb-px transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-t-lg',
              active
                ? 'border-accent text-accent'
                : 'border-transparent text-muted hover:text-ink hover:border-slate-300',
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function currentTab(pathname: string, params: URLSearchParams, tabs: TabDef[]) {
  if (pathname.startsWith('/teacher/')) return 'surveys';
  const t = params.get('tab') ?? tabs[0].id;
  return tabs.some((x) => x.id === t) ? t : tabs[0].id;
}
