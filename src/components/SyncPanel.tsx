'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useQuery, useConvexAuth } from 'convex/react';
import { UploadCloud, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, Music2, Search, Check } from 'lucide-react';
import { api } from '@convex/_generated/api';
import type { Doc, Id } from '@convex/_generated/dataModel';
import { useAnnounce } from '@/components/LiveRegion';
import { BlockSkeleton } from '@/components/Skeleton';
import { ResolveTrackDialog } from '@/components/ResolveTrackDialog';
import { artwork, badge, btn, cn, panel } from '@/lib/design';
import type { ProviderName } from '@/lib/providers';

const PROVIDER_LABEL: Record<ProviderName, string> = {
  spotify: 'Spotify',
  youtube: 'YouTube Music',
};

/**
 * Survey-level sync.
 *
 * Deliberately not per-submission: dedupe only works across everything at once.
 * Twelve students picking the same song is one add here, whereas syncing each
 * submission separately added it twelve times.
 */
export function SyncPanel({ survey }: { survey: Doc<'surveys'> }) {
  const announce = useAnnounce();
  const { isAuthenticated } = useConvexAuth();
  const settings = useQuery(api.settings.get, isAuthenticated ? {} : 'skip');
  const pending = useQuery(
    api.songs.listApprovedForSync,
    isAuthenticated ? { surveyId: survey._id as Id<'surveys'> } : 'skip',
  ) as Doc<'songs'>[] | undefined;

  const [showPlan, setShowPlan] = useState(true);
  const [resolving, setResolving] = useState<Doc<'songs'>[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; partial?: boolean } | null>(null);

  // The survey records the provider it was built for; settings is the fallback.
  const loading = settings === undefined || pending === undefined;
  const provider: ProviderName | null =
    (survey.provider as ProviderName | null) ?? (settings?.provider as ProviderName | null) ?? null;
  const connected = (settings?.provider as ProviderName | null) ?? null;
  const mismatch = Boolean(provider && connected && provider !== connected);

  const approved = useMemo(() => pending ?? [], [pending]);

  /**
   * Collapse to exactly what will be written, using the SAME key the sync
   * engine uses — so the preview is the plan, not an approximation of it.
   */
  const plan = useMemo(() => {
    const byKey = new Map<string, { song: Doc<'songs'>; pickedBy: Doc<'songs'>[] }>();
    for (const song of approved) {
      const key = song.providerTrackId ?? song.isrc ?? `manual:${song._id}`;
      const entry = byKey.get(key);
      // Keep every row, not just the first: matching a track has to apply to
      // all of them or the group splits and the song can be added twice.
      if (entry) entry.pickedBy.push(song);
      else byKey.set(key, { song, pickedBy: [song] });
    }
    // Group by the playlist each track is destined for.
    const groups = new Map<string, { song: Doc<'songs'>; pickedBy: Doc<'songs'>[] }[]>();
    for (const entry of byKey.values()) {
      const t = entry.song.playlistTarget;
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t)!.push(entry);
    }
    return groups;
  }, [approved]);

  const unique = [...plan.values()].reduce((n, g) => n + g.length, 0);
  const dupes = approved.length - unique;
  const unlinked = [...new Set(approved.map((s) => s.playlistTarget))].filter(
    (t) => !survey.allowedPlaylists.some((p) => p.label === t && p.providerPlaylistId),
  );

  async function sync() {
    if (!provider) return;
    setSyncing(true); setResult(null);
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surveyId: survey._id, provider }),
      });
      const body = await res.json();
      if (!res.ok && res.status !== 207) {
        setResult({ ok: false, message: body.error ?? 'Sync failed' });
        announce(`Sync failed. ${body.error ?? ''}`);
        return;
      }
      // 207 means it stopped early — never render that as plain success.
      setResult({ ok: true, message: body.message, partial: res.status === 207 });
      announce(body.message);
    } catch {
      setResult({ ok: false, message: 'Could not reach the sync service.' });
    } finally { setSyncing(false); }
  }

  return (
    <section className={cn(panel, 'p-6')} aria-labelledby="syncH">
      <h2 id="syncH" className="text-lg font-medium">
        {provider ? `Sync to ${PROVIDER_LABEL[provider]}` : 'Sync'}
      </h2>
      <p className="text-sm text-muted mt-1">
        Syncs every approved track in this class at once, grouped by the playlist each
        student chose. Duplicates and already-synced tracks are skipped.
      </p>

      {!loading && !provider && (
        <div className="mt-4 border border-amber-200 bg-amber-50 rounded-lg p-4" role="alert">
          <p className="text-sm text-warn font-medium">No music provider connected</p>
          <p className="text-sm text-muted mt-1">Connect one in Settings before syncing.</p>
          <Link href="/teacher?tab=settings" className={cn(btn.secondary, 'mt-3')}>Go to Settings</Link>
        </div>
      )}

      {!loading && mismatch && provider && connected && (
        <div className="mt-4 border border-amber-200 bg-amber-50 rounded-lg p-4" role="alert">
          <p className="text-sm text-warn font-medium">
            This class was set up for {PROVIDER_LABEL[provider]}, but you are connected to{' '}
            {PROVIDER_LABEL[connected]}
          </p>
          <p className="text-sm text-muted mt-1">
            Its playlist links only work on the account that created them. Re-pick the
            playlists in the Playlists tab, then edit this survey to point at them.
          </p>
        </div>
      )}

      {!loading && unlinked.length > 0 && provider && !mismatch && (
        <div className="mt-4 border border-amber-200 bg-amber-50 rounded-lg p-4" role="alert">
          <p className="text-sm text-warn font-medium">
            No playlist linked for: {unlinked.join(', ')}
          </p>
          <p className="text-sm text-muted mt-1">
            Tracks students sent to {unlinked.length === 1 ? 'it' : 'them'} cannot sync until
            you offer {unlinked.length === 1 ? 'a playlist' : 'playlists'} in the Playlists tab.
          </p>
        </div>
      )}

      {!loading && unique > 0 && (
        <div className="mt-5 pt-5 border-t border-rule">
          <button type="button" onClick={() => setShowPlan((v) => !v)}
            aria-expanded={showPlan} aria-controls="sync-plan"
            className={cn(btn.ghost, '!min-h-0 !px-2 -ml-2')}>
            {showPlan
              ? <ChevronDown className="w-4 h-4" aria-hidden="true" />
              : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
            {showPlan ? 'Hide' : 'Show'} the {unique} track{unique === 1 ? '' : 's'} that will be added
          </button>

          <div id="sync-plan" hidden={!showPlan} className="mt-3 space-y-5">
            {[...plan.entries()].map(([target, entries]) => {
              const linked = survey.allowedPlaylists.find((p) => p.label === target)?.providerPlaylistId;
              return (
                <div key={target}>
                  <h3 className="text-sm font-medium flex flex-wrap items-center gap-2">
                    {target}
                    <span className="text-muted font-normal">
                      {entries.length} track{entries.length === 1 ? '' : 's'}
                    </span>
                    {!linked && <span className={badge.flagged}>No playlist linked</span>}
                  </h3>
                  <ul className="mt-2 divide-y divide-slate-100 border border-rule rounded-lg">
                    {entries.map(({ song, pickedBy }) => {
                      // An exact provider URI syncs verbatim. Anything else has to
                      // be looked up and may not be found — worth knowing BEFORE
                      // the write, not after.
                      const exact = Boolean(song.providerTrackId) && provider === 'spotify';
                      return (
                        <li key={song._id} className="flex items-center gap-3 p-2.5">
                          {song.artworkUrl
                            ? <Image src={song.artworkUrl} alt="" width={36} height={36}
                                className={artwork.sm} unoptimized />
                            : <div className={cn(artwork.sm, 'grid place-items-center')} aria-hidden="true">
                                <Music2 className="w-4 h-4 text-slate-400" />
                              </div>}
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{song.title}</div>
                            <div className="text-sm text-muted truncate">{song.artist}</div>
                          </div>
                          {pickedBy.length > 1 && (
                            <span className={cn(badge.pending, 'shrink-0')}>
                              {pickedBy.length} students
                            </span>
                          )}
                          {song.providerTrackTitle && (
                            <span className={cn(badge.clean, 'shrink-0')}>
                              <Check className="w-3.5 h-3.5" aria-hidden="true" /> Matched
                            </span>
                          )}
                          {!exact && provider && (
                            // Actionable, not just a warning: the teacher can pick
                            // the right track instead of denying it or asking the
                            // student to submit again.
                            <button type="button" onClick={() => setResolving(pickedBy)}
                              aria-label={`Find a match for ${song.title} by ${song.artist}`}
                              className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium bg-amber-50 text-warn border border-amber-200 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                              <Search className="w-3.5 h-3.5" aria-hidden="true" />
                              Find match
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
            {[...plan.values()].flat().some(({ song }) => !(song.providerTrackId && provider === 'spotify')) && (
              <p className="text-sm text-muted">
                Tracks marked <strong className="text-ink font-medium">Find match</strong> have no exact{' '}
                {PROVIDER_LABEL[provider ?? 'spotify']} id, so sync has to guess and may not find them.
                Pick the right one now and it syncs exactly.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="mt-5 pt-5 border-t border-rule flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="text-sm text-muted flex-1">
          {loading
            ? <BlockSkeleton lines={1} label="Counting approved tracks" />
            : unique === 0
              ? 'Nothing to sync. Approve tracks in a response first.'
              : <>
                  <span className="text-ink font-medium">{unique}</span>{' '}
                  track{unique === 1 ? '' : 's'} ready across{' '}
                  {new Set(approved.map((s) => s.playlistTarget)).size} playlist
                  {new Set(approved.map((s) => s.playlistTarget)).size === 1 ? '' : 's'}.
                  {dupes > 0 && (
                    <span> {dupes} duplicate{dupes === 1 ? '' : 's'} across students skipped.</span>
                  )}
                  {provider === 'youtube' && (
                    <span className="block mt-0.5">
                      YouTube matches by title, not exact ID — check the playlist afterwards.
                    </span>
                  )}
                </>}
        </div>
        <button type="button" onClick={sync}
          disabled={loading || syncing || unique === 0 || !provider || mismatch}
          className={btn.primary}>
          <UploadCloud className="w-5 h-5" aria-hidden="true" />
          {syncing ? 'Syncing…' : 'Sync approved tracks'}
        </button>
      </div>

      <ResolveTrackDialog
        group={resolving}
        provider={provider ?? 'spotify'}
        open={resolving !== null}
        onClose={() => setResolving(null)}
      />

      {result && (
        <div role="status" aria-live="polite" className="mt-5 pt-5 border-t border-rule">
          <div className="flex items-start gap-2.5">
            {result.ok && !result.partial
              ? <CheckCircle2 className="w-5 h-5 text-ok shrink-0 mt-0.5" aria-hidden="true" />
              : <AlertTriangle className={cn('w-5 h-5 shrink-0 mt-0.5', result.ok ? 'text-warn' : 'text-bad')} aria-hidden="true" />}
            <p className={cn('text-sm', result.ok ? 'text-ink' : 'text-bad font-medium')}>{result.message}</p>
          </div>
        </div>
      )}
    </section>
  );
}
