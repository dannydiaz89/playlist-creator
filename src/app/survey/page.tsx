'use client';
import { useState, useMemo, Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation } from 'convex/react';
import { Plus, CheckCircle2, Info } from 'lucide-react';
import { api } from '@convex/_generated/api';
import { SongRow, type RowState, type Question } from '@/components/SongRow';
import { AnnounceProvider, useAnnounce } from '@/components/LiveRegion';
import { Dialog } from '@/components/Dialog';
import { btn, input, panel, badge, layout, cn } from '@/lib/design';

const MAX_SONGS = 10;
const MAX_MANUAL = 2;

/** Coarse per-browser key so the server-side rate limiter has something to bind to. */
function clientKey(): string {
  const K = 'pc_client_key';
  try {
    let v = localStorage.getItem(K);
    if (!v) { v = crypto.randomUUID(); localStorage.setItem(K, v); }
    return v;
  } catch { return 'anon'; }
}

function newRow(id: number, target: string): RowState {
  return { id, picked: null, target, answers: {}, manualOpen: false,
           manualTitle: '', manualArtist: '', manualError: '' };
}

function SurveyInner() {
  const params = useSearchParams();
  const code = (params.get('code') ?? '').toUpperCase();
  const announce = useAnnounce();

  const survey = useQuery(api.surveys.getByCode, code ? { code } : 'skip');
  const submit = useMutation(api.submissions.submit);

  // Monotonic. Never reuse ids as a counter — that produces duplicate DOM ids
  // and mislinked <label for>.
  const [nextId, setNextId] = useState(1);
  const [rows, setRows] = useState<RowState[]>([]);
  const [name, setName] = useState('');
  const [seat, setSeat] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ count: number; manual: number } | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);

  const songQuestions = useMemo(
    () => ((survey?.questions ?? []) as Question[]).filter((q) => q.scope === 'song'),
    [survey],
  );
  const subQuestions = useMemo(
    () => ((survey?.questions ?? []) as Question[]).filter((q) => q.scope === 'submission'),
    [survey],
  );
  const labels = survey?.playlistLabels ?? [];
  // Search the platform this class actually syncs to, so a pick is guaranteed
  // to exist there. YouTube falls back to Deezer: its search costs 100 quota
  // units per call, which students would exhaust in minutes.
  const catalogSource: 'spotify' | 'deezer' =
    survey?.provider === 'spotify' ? 'spotify' : 'deezer';

  useEffect(() => {
    if (survey && rows.length === 0 && labels.length) {
      setRows([newRow(1, labels[0])]);
      setNextId(2);
    }
  }, [survey, rows.length, labels]);

  const manualCount = rows.filter((r) => r.picked?.source === 'manual').length;

  function updateRow(id: number, next: Partial<RowState>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...next } : r)));
  }

  function addRow() {
    if (rows.length >= MAX_SONGS) return;
    setRows((rs) => [...rs, newRow(nextId, labels[0] ?? '')]);
    setNextId((n) => n + 1);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError('');
    const picked = rows.filter((r) => r.picked);
    const errs: Record<string, string> = {};

    if (!name.trim()) errs['name'] = 'Your name is required.';
    if (!picked.length) {
      announce('Error: pick at least one song before submitting.');
      setErrors({ ...errs, songs: 'Pick at least one song.' });
      return;
    }

    // Mirrors the server rule exactly: teacher-set `required`, escalated to
    // required when that song is flagged or unverified.
    for (const r of picked) {
      const forced = r.picked!.screen.status !== 'clean';
      songQuestions.forEach((q, qi) => {
        if ((q.required || (forced && qi === 0)) && !(r.answers[q.id] ?? '').trim()) {
          errs[`${r.id}:${q.id}`] = 'This one is required.';
        }
      });
    }
    for (const q of subQuestions) {
      if (q.required && !(answers[q.id] ?? '').trim()) errs[`sub:${q.id}`] = 'This one is required.';
    }

    setErrors(errs);
    if (Object.keys(errs).length) {
      announce(`${Object.keys(errs).length} field(s) still need an answer.`);
      return;
    }

    setBusy(true);
    try {
      const res = await submit({
        code,
        studentName: name,
        studentSeat: seat || undefined,
        answers,
        clientKey: clientKey(),
        songs: picked.map((r) => ({
          source: r.picked!.source,
          title: r.picked!.title,
          artist: r.picked!.artist,
          isrc: r.picked!.isrc,
          deezerId: r.picked!.source === 'catalog' && r.picked!.deezerId
            ? r.picked!.deezerId : null,
          providerTrackId: r.picked!.providerTrackId ?? null,
          durationSec: r.picked!.durationSec || null,
          artworkUrl: r.picked!.artworkUrl || null,
          isExplicit: r.picked!.isExplicit,
          playlistTarget: r.target,
          answers: r.answers,
        })),
      });
      setDone({ count: res.songCount, manual: manualCount });
      announce(`${res.songCount} songs submitted.`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not submit. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function resetForm() {
    setRows([newRow(nextId, labels[0] ?? '')]);
    setNextId((n) => n + 1);
    setAnswers({});
    setErrors({});
    setDone(null);
  }

  if (!code) {
    return <Shell>
      <div className={cn(panel, 'p-6')}>
        <h1 className="text-lg font-medium">No class code</h1>
        <p className="text-sm text-muted mt-2">
          Go back and enter the join code your teacher gave you.
        </p>
      </div>
    </Shell>;
  }
  if (survey === undefined) {
    return <Shell>
      <h1 className="sr-only">Loading class survey</h1>
      <p className="text-muted" role="status" aria-live="polite">Loading…</p>
    </Shell>;
  }
  if (survey === null) {
    return <Shell>
      <div className={cn(panel, 'p-6')}>
        <h1 className="text-lg font-medium">Code not found</h1>
        <p className="text-sm text-muted mt-2">
          We couldn&apos;t find a class with the code <span className="font-mono font-semibold">{code}</span>.
          Double-check the whiteboard.
        </p>
      </div>
    </Shell>;
  }
  if (!survey.isActive) {
    return <Shell>
      <div className={cn(panel, 'p-6')}>
        <h1 className="text-lg font-medium">Survey closed</h1>
        <p className="text-sm text-muted mt-2">
          {survey.className} isn&apos;t accepting suggestions right now.
        </p>
      </div>
    </Shell>;
  }

  return (
    <>
      <header className="bg-white border-b border-rule">
        <div className={cn(layout.reading, 'h-16 flex items-center justify-between gap-4')}>
          <div className="min-w-0">
            <h1 className="font-semibold truncate">{survey.className}</h1>
            <p className="text-sm text-muted">Song suggestions</p>
          </div>
          <span className={badge.code}>{survey.code}</span>
        </div>
      </header>

      <main id="main" className={cn(layout.reading, 'flex-1 py-8')}>
        <div className={cn(panel, 'p-4 mb-6 flex gap-3')}>
          <Info className="w-5 h-5 text-accent shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">Search and pick a real track</p>
            <p className="text-sm text-muted mt-0.5">
              Your teacher reviews everything first. Explicit tracks aren&apos;t blocked here —
              they&apos;re just marked, so your teacher can decide.
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <section className={cn(panel, 'p-6')}>
            <h2 className="text-lg font-medium mb-4">About you</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="studentName" className="block text-sm font-medium mb-1.5">
                  Your name <span className="text-bad" aria-hidden="true">*</span>
                  <span className="sr-only">(required)</span>
                </label>
                <input id="studentName" className={input.base} value={name}
                  onChange={(e) => setName(e.target.value)} placeholder="Alex Morgan"
                  autoComplete="name" aria-invalid={errors['name'] ? true : undefined} />
                {errors['name'] && <p role="alert" className="text-sm text-bad font-medium mt-1.5">{errors['name']}</p>}
              </div>
              <div>
                <label htmlFor="studentSeat" className="block text-sm font-medium mb-1.5">
                  Desk or period <span className="text-muted font-normal">(optional)</span>
                </label>
                <input id="studentSeat" className={input.base} value={seat}
                  onChange={(e) => setSeat(e.target.value)} placeholder="Desk 12" />
              </div>
            </div>
          </section>

          <section className={cn(panel, 'p-6')}>
            <div className="flex items-center justify-between gap-4 mb-1">
              <h2 className="text-lg font-medium">Your songs</h2>
              <span className="text-sm text-muted" aria-live="polite">{rows.length} of {MAX_SONGS}</span>
            </div>
            <p className="text-sm text-muted mb-4">Start typing a song name, then pick from the results.</p>

            <div data-song-rows className="space-y-3">
              {rows.map((r, i) => (
                <SongRow
                  key={r.id} row={r} index={i} total={rows.length}
                  questions={songQuestions} playlistLabels={labels}
                  canAddManual={manualCount < MAX_MANUAL}
                  catalogSource={catalogSource}
                  errors={errors}
                  onChange={(next) => updateRow(r.id, next)}
                  onRemove={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                />
              ))}
            </div>
            {errors['songs'] && <p role="alert" className="text-sm text-bad font-medium mt-2">{errors['songs']}</p>}

            <button type="button" onClick={addRow} disabled={rows.length >= MAX_SONGS}
              className={cn(btn.secondary, 'mt-3')}>
              <Plus className="w-5 h-5" aria-hidden="true" />
              Add another song
            </button>
          </section>

          {subQuestions.length > 0 && (
            <section className={cn(panel, 'p-6')}>
              <h2 className="text-lg font-medium mb-1">Questions from your teacher</h2>
              <p className="text-sm text-muted mb-4">These are about your whole submission.</p>
              <div className="space-y-5">
                {subQuestions.map((q) => {
                  const err = errors[`sub:${q.id}`];
                  return (
                    <div key={q.id}>
                      <label htmlFor={`sq-${q.id}`} className="block text-sm font-medium mb-1">
                        {q.label}{' '}
                        {q.required
                          ? <><span className="text-bad" aria-hidden="true">*</span><span className="sr-only">(required)</span></>
                          : <span className="text-muted font-normal">(optional)</span>}
                      </label>
                      {q.helpText && <p id={`sq-${q.id}-help`} className="text-sm text-muted mb-2">{q.helpText}</p>}
                      <textarea id={`sq-${q.id}`} rows={2} className={input.base} maxLength={q.maxLength}
                        aria-describedby={q.helpText ? `sq-${q.id}-help` : undefined}
                        aria-invalid={err ? true : undefined}
                        value={answers[q.id] ?? ''}
                        onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
                      {err && <p role="alert" className="text-sm text-bad font-medium mt-1.5">{err}</p>}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {submitError && (
            <p role="alert" className={cn(panel, 'p-4 text-sm text-bad font-medium')}>{submitError}</p>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <p className="text-sm text-muted">Reviewed by your teacher before syncing.</p>
            <button type="submit" disabled={busy} className={btn.primary}>
              {busy ? 'Submitting…' : 'Submit suggestions'}
            </button>
          </div>
        </form>
      </main>

      <Dialog open={done !== null} onClose={resetForm} title="Suggestions submitted">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-200 grid place-items-center mx-auto mb-4">
            <CheckCircle2 className="w-6 h-6 text-ok" aria-hidden="true" />
          </div>
          <p className="text-sm text-muted mb-6">
            {done?.count} song{done?.count === 1 ? '' : 's'} sent to your teacher for review.
            {done && done.manual > 0 && ` ${done.manual} need looking up by hand.`}
          </p>
          <button type="button" data-autofocus onClick={resetForm} className={cn(btn.primary, 'w-full')}>
            Submit more songs
          </button>
        </div>
      </Dialog>
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main id="main" className={cn(layout.reading, 'flex-1 py-12')}>{children}</main>;
}

export default function SurveyPage() {
  return (
    <Suspense fallback={null}>
      <AnnounceProvider><SurveyInner /></AnnounceProvider>
    </Suspense>
  );
}
