'use client';
import { useRef } from 'react';
import Image from 'next/image';
import { Music2 } from 'lucide-react';
import { useCatalogSearch, fetchTrackDetail } from '@/lib/useCatalogSearch';
import { useAnnounce } from '@/components/LiveRegion';
import { screenTrack } from '@convex/lib/screening';
import { artwork, badge, btn, cn, input } from '@/lib/design';
import type { CatalogTrack } from '@/lib/catalog';

export interface PickedSong extends CatalogTrack {
  source: 'catalog' | 'manual';
  screen: ReturnType<typeof screenTrack>;
}

export interface RowState {
  id: number;
  picked: PickedSong | null;
  target: string;
  answers: Record<string, string>;
  manualOpen: boolean;
  manualTitle: string;
  manualArtist: string;
  manualError: string;
}

export interface Question {
  id: string;
  label: string;
  helpText?: string;
  scope: 'song' | 'submission';
  required: boolean;
  maxLength: number;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function SongRow({
  row, index, total, questions, playlistLabels, canAddManual, errors, catalogSource,
  onChange, onRemove,
}: {
  row: RowState;
  index: number;
  total: number;
  questions: Question[];
  playlistLabels: string[];
  canAddManual: boolean;
  errors: Record<string, string>;
  catalogSource: 'spotify' | 'deezer';
  onChange: (next: Partial<RowState>) => void;
  onRemove: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { state, search, reset } = useCatalogSearch(catalogSource);
  const announce = useAnnounce();

  /**
   * Focus a field in this row without letting the browser choose the scroll.
   * The row sits above the button that triggered the change, so the layout
   * shifts and the implicit scroll-on-focus overshoots past the field.
   * Synchronous: a smooth scroll is dropped after a DOM mutation, and rAF does
   * not fire while the tab is hidden.
   */
  function focusInRow(el: HTMLElement | null) {
    if (!el) return;
    el.focus({ preventScroll: true });
    rowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }

  async function pickCatalog(hit: CatalogTrack) {
    try {
      // Spotify results already carry ISRC and the exact URI; only Deezer needs
      // a second call, because its search response omits the ISRC.
      const full = hit.providerTrackId ? hit : await fetchTrackDetail(hit.deezerId);
      const screen = screenTrack({ title: full.title, artist: full.artist, isExplicit: full.isExplicit, source: 'catalog' });
      onChange({ picked: { ...full, source: 'catalog', screen } });
      reset();
      announce(`Selected ${full.title} by ${full.artist}.${screen.status === 'flagged' ? ' This track is flagged.' : ''}`);
    } catch {
      announce('Could not load that track. Try again.');
    }
  }

  function saveManual() {
    const title = row.manualTitle.trim();
    const artist = row.manualArtist.trim();
    if (!title || !artist) {
      onChange({ manualError: 'Enter both a song title and an artist.' });
      announce('Error: enter both a song title and an artist.');
      return;
    }
    const screen = screenTrack({ title, artist, source: 'manual' });
    onChange({
      manualError: '',
      manualOpen: false,
      picked: {
        deezerId: 0, title, artist, album: '', durationSec: 0, artworkUrl: '',
        isExplicit: false, isrc: null, source: 'manual', screen,
      },
    });
    announce(`Added manual request: ${title} by ${artist}. Your teacher will look it up.`);
  }

  function clearPick() {
    onChange({ picked: null, manualOpen: false, answers: {} });
    reset();
    setTimeout(() => focusInRow(searchRef.current), 0);
  }

  const picked = row.picked;
  const forced = picked ? picked.screen.status !== 'clean' : false;

  return (
    <div ref={rowRef} className="border border-rule rounded-lg p-3">
      <div className="flex items-start justify-between gap-3 mb-2">
        <span className="text-sm font-medium text-muted pt-2.5">Song {index + 1}</span>
        {total > 1 && (
          <button type="button" onClick={onRemove} aria-label={`Remove song ${index + 1}`} className={btn.ghostSm}>
            Remove
          </button>
        )}
      </div>

      {!picked && !row.manualOpen && (
        <div>
          <label htmlFor={`q-${row.id}`} className="block text-sm font-medium mb-1.5">Search for a song</label>
          <input
            id={`q-${row.id}`} ref={searchRef} className={input.base}
            placeholder="Song name or artist" autoComplete="off"
            role="combobox" aria-expanded={state.kind === 'results'}
            aria-controls={`results-${row.id}`} aria-autocomplete="list"
            onChange={(e) => search(e.target.value)}
          />

          <div id={`results-${row.id}`} role="listbox" aria-label="Search results" className="mt-2 space-y-1">
            {state.kind === 'results' && state.hits.map((t) => (
              <button
                key={t.deezerId} type="button" role="option" aria-selected={false}
                // Nested spans/img do not compute a usable accessible name.
                aria-label={`${t.title} by ${t.artist}, ${fmt(t.durationSec)}${t.isExplicit ? ', marked explicit' : ''}`}
                onClick={() => pickCatalog(t)}
                className="w-full flex items-center gap-3 p-2 rounded-lg border border-rule bg-white hover:bg-slate-50 text-left"
              >
                {t.artworkUrl
                  ? <Image src={t.artworkUrl} alt="" width={40} height={40} className={artwork.md} unoptimized />
                  : <div className={artwork.md} />}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">{t.title}</span>
                  <span className="block text-sm text-muted truncate">{t.artist} · {fmt(t.durationSec)}</span>
                </span>
                {t.isExplicit && <span className={cn(badge.flagged, 'shrink-0')}>Explicit</span>}
              </button>
            ))}
          </div>

          <p className="text-sm text-muted mt-2" role="status" aria-live="polite">
            {state.kind === 'searching' && 'Searching…'}
            {state.kind === 'empty' && (
              <>
                No matches. Searching by artist name works better than lyrics.{' '}
                {canAddManual ? (
                  <button type="button" onClick={() => { onChange({ manualOpen: true }); announce('Manual request opened.'); }}
                    className="underline text-accent font-medium">
                    Can&apos;t find it? Request it manually
                  </button>
                ) : (
                  <span className="text-bad font-medium">You can request at most 2 songs manually.</span>
                )}
              </>
            )}
            {/* Never falls back to accepting free text — that reintroduces the
                disambiguation problem the catalog exists to remove. */}
            {state.kind === 'unavailable' && <span className="text-bad font-medium">{state.message}</span>}
          </p>
        </div>
      )}

      {row.manualOpen && !picked && (
        <div>
          <p className="text-sm font-medium mb-1">Request it manually</p>
          <p className="text-sm text-muted mb-3">
            Your teacher has to look this one up by hand, so it takes longer to approve.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor={`mt-${row.id}`} className="block text-sm font-medium mb-1.5">Song title</label>
              <input id={`mt-${row.id}`} className={input.base} value={row.manualTitle}
                onChange={(e) => onChange({ manualTitle: e.target.value })} placeholder="Song title" />
            </div>
            <div>
              <label htmlFor={`ma-${row.id}`} className="block text-sm font-medium mb-1.5">Artist</label>
              <input id={`ma-${row.id}`} className={input.base} value={row.manualArtist}
                onChange={(e) => onChange({ manualArtist: e.target.value })} placeholder="Artist" />
            </div>
          </div>
          {row.manualError && <p role="alert" className="text-sm text-bad font-medium mt-2">{row.manualError}</p>}
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" onClick={saveManual} className={btn.secondary}>Use this</button>
            <button type="button" onClick={() => onChange({ manualOpen: false, manualError: '' })} className={btn.ghost}>
              Back to search
            </button>
          </div>
        </div>
      )}

      {picked && (
        <>
          <div className="flex items-center gap-3">
            {picked.artworkUrl
              ? <Image src={picked.artworkUrl} alt="" width={48} height={48} className={artwork.lg} unoptimized />
              : <div className={cn(artwork.lg, 'grid place-items-center')} aria-hidden="true">
                  <Music2 className="w-5 h-5 text-slate-400" />
                </div>}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{picked.title}</div>
              <div className="text-sm text-muted truncate">
                {picked.artist}{picked.durationSec ? ` · ${fmt(picked.durationSec)}` : ''}
              </div>
            </div>
            <button type="button" onClick={clearPick} className={btn.ghostSm}>Change</button>
          </div>

          <div className="mt-3 flex items-start gap-2">
            {picked.screen.status === 'unverified' && (
              <>
                <span className={cn(badge.unverified, 'shrink-0')}>Manual request</span>
                <p className="text-sm text-muted">
                  We couldn&apos;t check this against the catalog, so your teacher looks it up by hand.
                </p>
              </>
            )}
            {picked.screen.status === 'flagged' && (
              <>
                <span className={cn(badge.flagged, 'shrink-0')}>Flagged</span>
                <p className="text-sm text-muted">
                  {picked.screen.isExplicitTag && 'Marked explicit by the label. '}
                  {picked.screen.matchedKeywords.join(', ')}
                  {picked.screen.matchedKeywords.length > 0 && '. '}
                  Your teacher decides.
                </p>
              </>
            )}
            {picked.screen.status === 'clean' && <span className={badge.clean}>No explicit tag</span>}
          </div>

          {questions.length > 0 && (
            <div className="mt-3 pt-3 border-t border-rule space-y-4">
              {questions.map((q, qi) => {
                const req = q.required || (forced && qi === 0);
                const err = errors[`${row.id}:${q.id}`];
                return (
                  <div key={q.id}>
                    <label htmlFor={`sq-${row.id}-${q.id}`} className="block text-sm font-medium mb-1">
                      {q.label}{' '}
                      {req
                        ? <><span className="text-bad" aria-hidden="true">*</span><span className="sr-only">(required)</span></>
                        : <span className="text-muted font-normal">(optional)</span>}
                    </label>
                    {q.helpText && <p id={`sq-${row.id}-${q.id}-help`} className="text-sm text-muted mb-2">{q.helpText}</p>}
                    <textarea
                      id={`sq-${row.id}-${q.id}`} rows={2} className={input.base} maxLength={q.maxLength}
                      aria-describedby={q.helpText ? `sq-${row.id}-${q.id}-help` : undefined}
                      aria-invalid={err ? true : undefined}
                      value={row.answers[q.id] ?? ''}
                      onChange={(e) => onChange({ answers: { ...row.answers, [q.id]: e.target.value } })}
                    />
                    {err && <p role="alert" className="text-sm text-bad font-medium mt-1.5">{err}</p>}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-rule">
            <label htmlFor={`pl-${row.id}`} className="block text-sm font-medium mb-1.5">Which playlist?</label>
            <select id={`pl-${row.id}`} className={input.base} value={row.target}
              onChange={(e) => onChange({ target: e.target.value })}>
              {playlistLabels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </>
      )}
    </div>
  );
}
