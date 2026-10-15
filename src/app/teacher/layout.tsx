'use client';
import { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { AnnounceProvider } from '@/components/LiveRegion';
import { Tabs, DASHBOARD_TABS } from '@/components/Tabs';
import { btn, layout, cn } from '@/lib/design';

/**
 * The dashboard shell. Lives in a layout so the header and tabs survive
 * navigation into a survey or a single response — those are still the
 * dashboard, not somewhere else.
 */
export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <AnnounceProvider>
      <header className="bg-white border-b border-rule">
        <div className={cn(layout.wide, 'h-16 flex items-center justify-between gap-4')}>
          <div>
            <h1 className="font-semibold">Teacher dashboard</h1>
            <p className="text-sm text-muted">Surveys, submissions and sync</p>
          </div>
          <button type="button" className={btn.secondary}
            onClick={async () => { await authClient.signOut(); router.push('/'); }}>
            Sign out
          </button>
        </div>
      </header>

      <main id="main" className={cn(layout.wide, 'flex-1 py-8')}>
        <Suspense fallback={null}>
          <Tabs tabs={DASHBOARD_TABS} />
        </Suspense>
        <div id="tab-panel" role="tabpanel" aria-labelledby="tab-surveys" tabIndex={-1} className="pt-6">
          {children}
        </div>
      </main>
    </AnnounceProvider>
  );
}
