'use client';
import { useState, use, Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useConvexAuth } from 'convex/react';
import { ArrowLeft } from 'lucide-react';
import { api } from '@convex/_generated/api';
import type { Id, Doc } from '@convex/_generated/dataModel';
import { useAnnounce } from '@/components/LiveRegion';
import { ScreenBadge, screenReasons } from '@/components/Badge';
import { BlockSkeleton } from '@/components/Skeleton';
import { artwork, badge, btn, cn, layout, panel, table } from '@/lib/design';
import type { ProviderName } from '@/lib/providers';

const PROVIDER_LABEL: Record<ProviderName, string> = {
  spotify: 'Spotify',
  youtube: 'YouTube Music',
};

const fmt = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');

function ReviewInner({ id }: { id: string }) {
  const announce = useAnnounce();
  // Return to the survey we came from, falling back to the dashboard.
  const from = useSearchParams().get('from');
  const backHref = from ? `/teacher/survey/${from}` : '/teacher';
  const { isAuthenticated } = useConvexAuth();
  const data = useQuery(
    api.submissions.getById,
    isAuthenticated ? { submissionId: id as Id<'submissions'> } : 'skip',
  );
  const priorDenials = useQuery(
    api.songs.priorDenials,
    isAuthenticated ? { submissionId: id as Id<'submissions'> } : 'skip',
  ) as Record<string, { count: number; reason?: string; at?: number }> | undefined;
  const updateDecision = useMutation(api.songs.updateDecision);
  const bulkApprove = useMutation(api.songs.bulkApproveClean);

  const settings = useQuery(api.settings.get, isAuthenticated ? {} : 'skip');

  if (data === undefined) {
    return (
      <div className="space-y-6">
        {/* Provider is not known until the submission loads, so only the back
            link renders here. */}
        <Link href={backHref} className={cn(btn.ghost, '!px-2 -ml-2')}>
          <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          {from ? 'Back to responses' : 'Dashboard'}
        </Link>
        <h1 className="sr-only">Loading submission</h1>
        <section className={cn(panel, 'p-6')}>
          <BlockSkeleton lines={2} label="Loading submission" />
        </section>
        <section className={cn(panel, 'p-6')}>
          <BlockSkeleton lines={4} label="Loading tracks" />
        </section>
      </div>
    );
  }

  const { submission, survey } = data as {
    submission: Doc<'submissions'>;
    survey: Doc<'surveys'>;
    songs: Doc<'songs'>[];
  };
  const songs: Doc<'songs'>[] = data.songs;
  const approved = songs.filter((s) => s.decision === 'approved');
  const pending = songs.filter((s) => s.decision === 'pending');
  /**
   * Show a question if it is still active OR this submission actually answered
   * it. Archiving preserves the answer in the database; filtering archived
   * questions out of the review screen makes that preserved work invisible,
   * which is the same outcome as deleting it.
   */
  const hasSubmissionAnswer = (id: string) => Boolean((submission.answers ?? {})[id]?.trim());
  const hasAnySongAnswer = (id: string) =>
    songs.some((s) => Boolean((s.answers ?? {})[id]?.trim()));

  // The survey records which provider it was built for; teacher settings is the
  // fallback for surveys created before one was picked. Asking again here would
  // let the teacher choose a provider they are not even connected to.
  const provider: ProviderName | null =
    (survey.provider as ProviderName | null) ?? (settings?.provider as ProviderName | null) ?? null;

  const subQuestions = survey.questions.filter(
    (q) => q.scope === 'submission' && (!q.archived || hasSubmissionAnswer(q.id)),
  );
  const songQuestions = survey.questions.filter(
    (q) => q.scope === 'song' && (!q.archived || hasAnySongAnswer(q.id)),
  );


  return (
    <>

      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Link href={backHref} className={cn(btn.ghost, '!px-2 -ml-2')}>
            <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            {from ? 'Back to responses' : 'Dashboard'}
          </Link>
          {provider && <span className={badge.clean}>{PROVIDER_LABEL[provider]}</span>}
        </div>
        <section className={cn(panel, 'p-6')}>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">{submission.studentName}</h1>
              <p className="text-sm text-muted mt-1">
                {survey.className}
                {submission.studentSeat && ` · ${submission.studentSeat}`}
                {` · ${songs.length} track${songs.length === 1 ? '' : 's'} `}
                <span className={cn(badge.code, 'ml-1')}>{survey.code}</span>
              </p>
            </div>
            <span className={pending.length ? badge.flagged : badge.clean}>
              {pending.length ? `${pending.length} need a decision` : 'All decided'}
            </span>
          </div>

          {subQuestions.length > 0 && (
            <div className="mt-5 pt-5 border-t border-rule space-y-4">
              {subQuestions.map((q) => (
                <div key={q.id}>
                  <h2 className="text-sm font-medium mb-1">
                    {q.label}
                    {q.archived && (
                      <span className={cn(badge.pending, 'ml-2 font-normal')}>No longer asked</span>
                    )}
                  </h2>
                  <p className="text-sm text-muted">{submission.answers[q.id] || <em>No answer</em>}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={panel} aria-labelledby="tracksH">
          <div className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 id="tracksH" className="text-lg font-medium">Tracks</h2>
              <p className="text-sm text-muted mt-1">
                Pre-checks are advisory — the catalog&apos;s explicit tag plus title keywords.{' '}
                <strong className="font-medium text-ink">Lyrics are not scanned.</strong>
              </p>
            </div>
            <button type="button" className={btn.secondary}
              onClick={async () => {
                const { approved: n, skippedPreviouslyDenied: skipped } =
                  await bulkApprove({ surveyId: survey._id, submissionId: submission._id });
                announce(
                  [
                    n ? `${n} verified-clean tracks approved.` : 'No verified-clean tracks were pending.',
                    skipped ? `${skipped} skipped — you denied ${skipped === 1 ? 'it' : 'them'} before.` : '',
                  ].filter(Boolean).join(' '),
                );
              }}>
              Approve all verified-clean
            </button>
          </div>

          <div className="overflow-x-auto border-t border-rule">
            <table className={table.root}>
              <caption className="sr-only">Tracks with pre-check results and decisions</caption>
              <thead>
                <tr>
                  <th scope="col" className={table.th}>Track</th>
                  <th scope="col" className={table.th}>Playlist</th>
                  <th scope="col" className={table.th}>Pre-check</th>
                  <th scope="col" className={table.th}>Decision</th>
                </tr>
              </thead>
              <tbody>
                {songs.map((s) => (
                  <tr key={s._id} className={s.decision === 'denied' ? 'bg-rose-50/40' : undefined}>
                    <td className={table.td}>
                      <div className="flex items-start gap-3">
                        {s.artworkUrl
                          ? <Image src={s.artworkUrl} alt="" width={40} height={40} className={artwork.md} unoptimized />
                          : <div className={cn(artwork.md, 'bg-slate-100')} />}
                        <div className="min-w-0">
                          <div className="font-medium">{s.title}</div>
                          <div className="text-muted">{s.artist}{s.durationSec ? ` · ${fmt(s.durationSec)}` : ''}</div>
                          <div className="text-muted font-mono text-xs mt-1">{s.isrc ?? 'no ISRC'}</div>
                          {songQuestions.map((q) => s.answers[q.id] && (
                            <p key={q.id} className="text-muted mt-1.5">
                              <span className="font-medium text-ink">{q.label}</span>
                              {q.archived && <span className="text-xs"> (no longer asked)</span>}
                              {' '}{s.answers[q.id]}
                            </p>
                          ))}
                        </div>
                      </div>
                    </td>
                    <td className={cn(table.td, 'text-muted')}>{s.playlistTarget}</td>
                    <td className={table.td}>
                      <ScreenBadge preScreen={s.preScreen} />
                      {s.preScreen.status === 'unverified' && (
                        <p className="text-sm text-muted mt-1.5">
                          Student typed this in — no explicit flag and no ISRC. Find it yourself before syncing.
                        </p>
                      )}
                      {s.preScreen.status === 'flagged' && (
                        <p className="text-sm text-muted mt-1.5">{screenReasons(s.preScreen)}</p>
                      )}
                      {priorDenials?.[s._id] && (
                        // A track the teacher already rejected looks identical to
                        // a fresh one otherwise — approving it would quietly
                        // reverse that call.
                        <div className="mt-2">
                          <span className={badge.flagged}>
                            Denied before{priorDenials[s._id].count > 1
                              ? ` (${priorDenials[s._id].count}×)` : ''}
                          </span>
                          {priorDenials[s._id].reason && (
                            <p className="text-sm text-muted mt-1">
                              Reason given: {priorDenials[s._id].reason}
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className={table.td}>
                      <fieldset>
                        <legend className="sr-only">Decision for {s.title} by {s.artist}</legend>
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                          {(['approved', 'denied'] as const).map((d) => (
                            <label key={d} className="flex items-center gap-2 text-sm">
                              <input type="radio" name={`decision-${s._id}`} value={d} className="w-4 h-4"
                                checked={s.decision === d}
                                onChange={async () => {
                                  await updateDecision({ songId: s._id, decision: d });
                                  announce(`${s.title} ${d}.`);
                                }} />
                              {d === 'approved' ? 'Approve' : 'Deny'}
                            </label>
                          ))}
                        </div>
                        {s.teacherOverride && (
                          <p className="text-sm text-muted mt-1.5">Recorded as a teacher override.</p>
                        )}
                      </fieldset>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </>
  );
}

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={null}>
      <ReviewInner id={id} />
    </Suspense>
  );
}
