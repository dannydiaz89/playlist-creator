'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { SurveysTab } from '@/components/SurveysTab';
import { SettingsTab } from '@/components/SettingsTab';
import { PlaylistsTab } from '@/components/PlaylistsTab';
import { currentTab, DASHBOARD_TABS } from '@/components/Tabs';

/** Content only — the header and tabs live in the layout. */
function DashboardInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = currentTab(pathname, new URLSearchParams(params.toString()), DASHBOARD_TABS);

  if (current === 'playlists') {
    return <PlaylistsTab onGoToSettings={() => router.replace('/teacher?tab=settings')} />;
  }
  if (current === 'settings') {
    return <SettingsTab onGoToPlaylists={() => router.replace('/teacher?tab=playlists')} />;
  }
  return <SurveysTab onGoToSettings={() => router.replace('/teacher?tab=playlists')} />;
}

export default function TeacherDashboard() {
  return (
    <Suspense fallback={null}>
      <DashboardInner />
    </Suspense>
  );
}
