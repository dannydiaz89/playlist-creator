'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useConvexAuth } from 'convex/react';
import { Plus, Copy, Check, Trash2, ChevronRight, ListMusic, Pencil } from 'lucide-react';
import { api } from '@convex/_generated/api';
import type { Doc, Id } from '@convex/_generated/dataModel';
import { useAnnounce } from '@/components/LiveRegion';
import { Dialog } from '@/components/Dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { QuestionEditor, type DraftQuestion } from '@/components/QuestionEditor';
import { TableSkeleton } from '@/components/Skeleton';
import { btn, input, panel, badge, table, cn } from '@/lib/design';
import { generateSurveyCode } from '@convex/lib/surveyCode';

export function SurveysTab({ onGoToSettings }: { onGoToSettings: () => void }) {
  const announce = useAnnounce();
  // 'skip' until the auth token exists, or the query fires unauthenticated and
  // throws "Not authenticated" straight into the error boundary.
  const { isAuthenticated } = useConvexAuth();
  const args = isAuthenticated ? {} : 'skip';
  const surveys = useQuery(api.surveys.list, args) as Doc<'surveys'>[] | undefined;
  const settings = useQuery(api.settings.get, args);
  const createSurvey = useMutation(api.surveys.create);
  const updateSurvey = useMutation(api.surveys.update);
  const toggleStatus = useMutation(api.surveys.toggleStatus);
  const removeSurvey = useMutation(api.surveys.remove);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Doc<'surveys'> | null>(null);
  const [className, setClassName] = useState('');
  const [code, setCode] = useState(generateSurveyCode());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [questions, setQuestions] = useState<DraftQuestion[]>([
    { id: 'q1', label: 'Why did you pick these songs?', scope: 'submission', required: true, maxLength: 500 },
  ]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [confirming, setConfirming] = useState<Doc<'surveys'> | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadingSettings = settings === undefined;
  const loadingSurveys = surveys === undefined;
  const pool = settings?.playlists ?? [];

  function openCreate() {
    setEditing(null);
    setClassName('');
    setPicked(new Set(pool.map((p) => p.label)));
    setCode(generateSurveyCode());
    setQuestions([{ id: `q${Date.now().toString(36)}`, label: 'Why did you pick these songs?',
                    scope: 'submission', required: true, maxLength: 500 }]);
    setError('');
    setOpen(true);
  }

  function openEdit(s: Doc<'surveys'>) {
    setEditing(s);
    setClassName(s.className);
    setCode(s.code);
    setPicked(new Set(s.allowedPlaylists.map((p) => p.label)));
    setQuestions(
      s.questions.filter((q) => !q.archived).map((q) => ({
        id: q.id, label: q.label, helpText: q.helpText,
        scope: q.scope, required: q.required, maxLength: q.maxLength,
      })),
    );
    setError('');
    setOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (picked.size === 0) {
      setError('Pick at least one playlist for students to choose from.');
      return;
    }
    const cleanQuestions = questions.filter((q) => q.label.trim()).map((q) => ({
      id: q.id, label: q.label.trim(), helpText: q.helpText || undefined,
      scope: q.scope, required: q.required, maxLength: q.maxLength,
    }));

    if (editing) {
      try {
        await updateSurvey({
          surveyId: editing._id,
          className,
          allowedPlaylists: pool.filter((p) => picked.has(p.label)),
          questions: cleanQuestions,
        });
        setOpen(false);
        announce(`${className} updated.`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save the changes.');
      }
      return;
    }

    try {
      await createSurvey({
        className,
        code,
        provider: settings?.provider ?? null,
        questions: cleanQuestions,
        // Snapshot of the teacher's pool, so later edits to Settings never
        // break a survey students are already using.
        allowedPlaylists: pool.filter((p) => picked.has(p.label)),
      });
      setOpen(false);
      setClassName('');
      announce(`Survey created with code ${code}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the survey.');
    }
  }

  async function copyLink(c: string) {
    try {
      await navigator.clipboard.writeText(`${location.origin}/survey?code=${c}`);
      setCopied(c); announce(`Link for ${c} copied.`);
      setTimeout(() => setCopied(''), 1800);
    } catch { announce('Copy failed.'); }
  }

  async function doDelete() {
    if (!confirming) return;
    setDeleting(true);
    try {
      const res = await removeSurvey({ surveyId: confirming._id as Id<'surveys'> });
      announce(`Deleted ${confirming.className} and ${res.deletedSubmissions} submissions.`);
      setConfirming(null);
    } finally { setDeleting(false); }
  }

  return (
    <>
      <section className={panel} aria-labelledby="surveysH">
        <div className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 id="surveysH" className="text-lg font-medium">Class surveys</h2>
            <p className="text-sm text-muted mt-1">
              Select a survey to see its responses.
            </p>
          </div>
          <button type="button" onClick={openCreate}
            disabled={loadingSettings || pool.length === 0} className={btn.primary}>
            <Plus className="w-5 h-5" aria-hidden="true" /> New survey
          </button>
        </div>

        {!loadingSettings && pool.length === 0 && (
          <div className="px-6 pb-6">
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-4">
              <p className="text-sm text-warn font-medium">No playlists linked yet</p>
              <p className="text-sm text-muted mt-1">
                A survey needs real playlists for students to choose from.
              </p>
              <button type="button" onClick={onGoToSettings} className={cn(btn.secondary, 'mt-3')}>
                <ListMusic className="w-5 h-5" aria-hidden="true" /> Go to Playlists
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto border-t border-rule">
          <table className={table.root}>
            <caption className="sr-only">Class surveys with join codes and status</caption>
            <thead>
              <tr>
                <th scope="col" className={table.th}>Class</th>
                <th scope="col" className={table.th}>Code</th>
                <th scope="col" className={table.th}>Playlists</th>
                <th scope="col" className={table.th}>Questions</th>
                <th scope="col" className={table.th}>Status</th>
                <th scope="col" className={table.th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            {loadingSurveys && (
              <TableSkeleton columns={['w-36', 'w-20', 'w-40', 'w-8', 'w-16', 'w-44']}
                label="Loading surveys" />
            )}
            <tbody>
              {(surveys ?? []).map((s) => (
                <tr key={s._id} className="hover:bg-slate-50/60">
                  <td className={table.td}>
                    <Link href={`/teacher/survey/${s._id}`}
                      className="font-medium text-accent hover:underline inline-flex items-center gap-1">
                      {s.className}
                      <ChevronRight className="w-4 h-4" aria-hidden="true" />
                    </Link>
                  </td>
                  <td className={table.td}><span className={badge.code}>{s.code}</span></td>
                  <td className={cn(table.td, 'text-muted')}>
                    {s.allowedPlaylists.map((p) => p.label).join(', ') || '—'}
                  </td>
                  <td className={table.td}>{s.questions.filter((q) => !q.archived).length}</td>
                  <td className={table.td}>
                    <span className={s.isActive ? badge.clean : badge.pending}>
                      {s.isActive ? 'Open' : 'Closed'}
                    </span>
                  </td>
                  <td className={table.td}>
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => copyLink(s.code)} className={btn.ghostSm}>
                        {copied === s.code
                          ? <><Check className="w-4 h-4" aria-hidden="true" />Copied</>
                          : <><Copy className="w-4 h-4" aria-hidden="true" />Copy link</>}
                      </button>
                      <button type="button" className={btn.ghostSm}
                        onClick={async () => {
                          const now = await toggleStatus({ surveyId: s._id });
                          announce(`${s.className} is now ${now ? 'open' : 'closed'}.`);
                        }}>
                        {s.isActive ? 'Close' : 'Reopen'}
                      </button>
                      <button type="button" onClick={() => openEdit(s)} className={btn.ghostSm}
                        aria-label={`Edit ${s.className}`}>
                        <Pencil className="w-4 h-4" aria-hidden="true" /> Edit
                      </button>
                      <button type="button" onClick={() => setConfirming(s)}
                        aria-label={`Delete ${s.className}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-bad hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bad">
                        <Trash2 className="w-4 h-4" aria-hidden="true" /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loadingSurveys && surveys?.length === 0 && (
            <p className="p-6 text-sm text-muted">No surveys yet. Create one to get a join code.</p>
          )}
        </div>
      </section>

      <Dialog open={open} onClose={() => setOpen(false)} size="lg"
        title={editing ? `Edit ${editing.className}` : 'New class survey'}>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="cls" className="block text-sm font-medium mb-1.5">Class name</label>
            <input id="cls" data-autofocus className={input.base} value={className}
              onChange={(e) => setClassName(e.target.value)} placeholder="Period 6 Band" required />
          </div>
          <div>
            <label htmlFor="cd" className="block text-sm font-medium mb-1.5">Join code</label>
            <div className="flex gap-2">
              <input id="cd" className={cn(input.base, 'font-mono font-semibold uppercase',
                       editing && 'bg-slate-50 text-muted')}
                value={code} readOnly={Boolean(editing)}
                onChange={(e) => setCode(e.target.value.toUpperCase())} required />
              {!editing && (
                <button type="button" onClick={() => setCode(generateSurveyCode())}
                  className={cn(btn.secondary, 'shrink-0')}>Randomize</button>
              )}
            </div>
            <p className="text-sm text-muted mt-1.5">
              {editing
                ? 'Fixed after creation — students already have this code.'
                : 'Read aloud in class, so I/O/0/1 are excluded.'}
            </p>
          </div>

          <fieldset>
            <legend className="text-sm font-medium mb-2">Playlists students can choose</legend>
            <div className="space-y-2">
              {pool.map((p) => (
                <label key={p.label} className="flex items-center gap-2.5 text-sm min-h-[44px]">
                  <input type="checkbox" className="w-4 h-4" checked={picked.has(p.label)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      e.target.checked ? next.add(p.label) : next.delete(p.label);
                      setPicked(next);
                    }} />
                  {p.label}
                </label>
              ))}
            </div>
            <p className="text-sm text-muted mt-2">
              Managed in the Playlists tab. These map to real playlists on your account.
            </p>
          </fieldset>

          <QuestionEditor questions={questions} onChange={setQuestions} editing={Boolean(editing)} />

          {error && <p role="alert" className="text-sm text-bad font-medium">{error}</p>}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className={btn.secondary}>Cancel</button>
            <button type="submit" className={btn.primary}>
              {editing ? 'Save changes' : 'Create survey'}
            </button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={confirming !== null}
        title={`Delete ${confirming?.className ?? ''}?`}
        confirmLabel="Delete survey"
        busy={deleting}
        onCancel={() => setConfirming(null)}
        onConfirm={doDelete}
        body={
          <>
            This permanently deletes the survey <strong className="text-ink">{confirming?.code}</strong>{' '}
            along with <strong className="text-ink">every student response and song</strong> in it.
            Synced tracks already in your playlist are not removed. This cannot be undone.
          </>
        }
      />
    </>
  );
}
