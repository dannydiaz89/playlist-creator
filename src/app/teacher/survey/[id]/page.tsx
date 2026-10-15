'use client';
import { use } from 'react';
import Link from 'next/link';
import { useQuery, useConvexAuth } from 'convex/react';
import { ArrowLeft, Copy } from 'lucide-react';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useAnnounce } from '@/components/LiveRegion';
import { SyncPanel } from '@/components/SyncPanel';
import { TableSkeleton, BlockSkeleton } from '@/components/Skeleton';
import { btn, panel, badge, table, layout, cn } from '@/lib/design';

interface Row {
  _id: Id<'submissions'>;
  studentName: string;
  studentSeat?: string;
  createdAt: number;
  songCount: number;
  flaggedCount: number;
  pendingCount: number;
  syncedCount: number;
}

function SurveyResponsesInner({ id }: { id: string }) {
  const announce = useAnnounce();
  const surveyId = id as Id<'surveys'>;
  const { isAuthenticated } = useConvexAuth();
  const survey = useQuery(api.surveys.get, isAuthenticated ? { surveyId } : 'skip');
  const rows = useQuery(
    api.submissions.listBySurvey, isAuthenticated ? { surveyId } : 'skip',
  ) as Row[] | undefined;

  if (survey === undefined) {
    return (
      <div className="space-y-6">
        <Link href="/teacher" className={cn(btn.ghost, '!px-2 -ml-2')}>
          <ArrowLeft className="w-5 h-5" aria-hidden="true" /> All surveys
        </Link>
        <h1 className="sr-only">Loading survey</h1>
        <section className={cn(panel, 'p-6')}>
          <BlockSkeleton lines={2} label="Loading survey" />
        </section>
        <section className={cn(panel, 'p-6')}>
          <BlockSkeleton lines={4} label="Loading responses" />
        </section>
      </div>
    );
  }

  return (
    <>

      <div className="space-y-6">
        <Link href="/teacher" className={cn(btn.ghost, '!px-2 -ml-2')}>
          <ArrowLeft className="w-5 h-5" aria-hidden="true" /> All surveys
        </Link>
        <section className={cn(panel, 'p-6')}>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">{survey.className}</h1>
              <p className="text-sm text-muted mt-1">
                {survey.allowedPlaylists.map((p) => p.label).join(' · ') || 'No playlists linked'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={survey.isActive ? badge.clean : badge.pending}>
                {survey.isActive ? 'Open' : 'Closed'}
              </span>
              <button type="button" className={btn.secondary}
                onClick={async () => {
                  await navigator.clipboard.writeText(`${location.origin}/survey?code=${survey.code}`);
                  announce('Student link copied.');
                }}>
                <Copy className="w-5 h-5" aria-hidden="true" /> Copy student link
              </button>
            </div>
          </div>
        </section>

        <SyncPanel survey={survey} />

        <section className={panel} aria-labelledby="respH">
          <div className="p-6">
            <h2 id="respH" className="text-lg font-medium">Responses</h2>
            <p className="text-sm text-muted mt-1">Updates live as students submit.</p>
          </div>
          <div className="overflow-x-auto border-t border-rule">
            <table className={table.root}>
              <caption className="sr-only">Student responses for {survey.className}</caption>
              <thead>
                <tr>
                  <th scope="col" className={table.th}>Student</th>
                  <th scope="col" className={table.th}>Songs</th>
                  <th scope="col" className={table.th}>Pre-check</th>
                  <th scope="col" className={table.th}>Status</th>
                  <th scope="col" className={table.th}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              {rows === undefined && (
                <TableSkeleton columns={['w-36', 'w-8', 'w-24', 'w-28', 'w-20']}
                  label="Loading responses" />
              )}
              <tbody>
                {(rows ?? []).map((s) => (
                  <tr key={s._id}>
                    <td className={table.td}>
                      <div className="font-medium">{s.studentName}</div>
                      {s.studentSeat && <div className="text-muted">{s.studentSeat}</div>}
                    </td>
                    <td className={table.td}>{s.songCount}</td>
                    <td className={table.td}>
                      {s.flaggedCount > 0
                        ? <span className={badge.flagged}>{s.flaggedCount} need review</span>
                        : <span className={badge.clean}>No flags</span>}
                    </td>
                    <td className={table.td}>
                      <span className={s.pendingCount > 0 ? badge.pending : badge.clean}>
                        {s.pendingCount > 0 ? 'Needs review'
                          : s.syncedCount > 0 ? 'Synced' : 'Decided'}
                      </span>
                    </td>
                    <td className={cn(table.td, 'text-right')}>
                      <Link href={`/teacher/review/${s._id}?from=${surveyId}`}
                        className={cn(s.pendingCount > 0 ? btn.primary : btn.secondary,
                                      '!min-h-0 !py-1.5 !px-3')}>
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows !== undefined && rows.length === 0 && (
              <p className="p-6 text-sm text-muted">
                No responses yet. Share the code <span className="font-mono font-semibold">{survey.code}</span> with your class.
              </p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

export default function SurveyResponsesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <SurveyResponsesInner id={id} />;
}
