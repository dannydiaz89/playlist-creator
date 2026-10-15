'use client';
import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useQuery, useMutation, useConvexAuth } from 'convex/react';
import { Plus, Check, RefreshCw, ListMusic, ExternalLink, Music2, Trash2 } from 'lucide-react';
import { api } from '@convex/_generated/api';
import { useAnnounce } from '@/components/LiveRegion';
import { Dialog } from '@/components/Dialog';
import { Skeleton, TableSkeleton, BlockSkeleton } from '@/components/Skeleton';
import { artwork, badge, btn, cn, input, panel, table } from '@/lib/design';
import type { ProviderPlaylist, ProviderName, PlaylistTrack } from '@/lib/providers';

const LABEL: Record<ProviderName, string> = {
  spotify: 'Spotify',
  youtube: 'YouTube Music',
};

const fmt = (s: number | null) =>
  s === null ? '' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function PlaylistsTab({ onGoToSettings }: { onGoToSettings: () => void }) {
  const announce = useAnnounce();
  const { isAuthenticated } = useConvexAuth();
  const args = isAuthenticated ? {} : 'skip';
  const settings = useQuery(api.settings.get, args);
  const setPlaylists = useMutation(api.settings.setPlaylists);
  const markRemoved = useMutation(api.songs.markRemovedFromPlaylist);

  const [available, setAvailable] = useState<ProviderPlaylist[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [viewing, setViewing] = useState<ProviderPlaylist | null>(null);
  const [tracks, setTracks] = useState<PlaylistTrack[] | null>(null);
  const [tracksError, setTracksError] = useState('');
  const [capped, setCapped] = useState(false);
  // Two-step inline confirm rather than a nested dialog: a dialog inside a
  // dialog fights over the focus trap.
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removedNote, setRemovedNote] = useState('');

  const provider = (settings?.provider ?? null) as ProviderName | null;
  const chosen = settings?.playlists ?? [];

  const load = useCallback(async (p: ProviderName) => {
    setLoading(true); setError(''); setAvailable(null);
    try {
      const res = await fetch(`/api/playlists?provider=${p}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Could not load playlists'); return; }
      setAvailable(data.playlists);
    } catch { setError('Could not reach the provider.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (provider) load(provider); }, [provider, load]);

  async function openTracks(pl: ProviderPlaylist) {
    setViewing(pl); setTracks(null); setTracksError(''); setCapped(false);
    setConfirmRemove(null); setRemovedNote('');
    try {
      const res = await fetch(`/api/playlists/tracks?provider=${provider}&playlistId=${pl.id}`);
      const data = await res.json();
      if (!res.ok) { setTracksError(data.error ?? 'Could not load tracks'); return; }
      setTracks(data.tracks); setCapped(Boolean(data.capped));

      // The table's count is whatever the list endpoint said when the page
      // loaded; changes made directly in the provider leave it stale. This
      // fetch is authoritative, so reconcile the row — but only when the
      // result was not truncated, or a 500-track playlist would read as 100.
      if (!data.capped) {
        setAvailable((prev) => prev?.map(
          (p) => (p.id === pl.id ? { ...p, trackCount: data.tracks.length } : p),
        ) ?? prev);
      }
      announce(`${data.tracks.length} tracks in ${pl.name}.`);
    } catch { setTracksError('Could not reach the provider.'); }
  }

  async function removeTrack(t: PlaylistTrack) {
    if (!viewing || !provider) return;
    // YouTube deletes by playlistItem id; Spotify by track uri.
    const ref = t.playlistItemId ?? t.providerTrackId;
    setRemoving(ref); setTracksError('');
    try {
      const res = await fetch('/api/playlists/tracks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, playlistId: viewing.id, ref }),
      });
      const data = await res.json();
      if (!res.ok) { setTracksError(data.error ?? 'Could not remove the track'); return; }

      const next = (tracks ?? []).filter(
        (x) => (x.playlistItemId ?? x.providerTrackId) !== ref,
      );
      setTracks(next);
      setConfirmRemove(null);

      // Keep the class record honest: the track really is gone, and it must not
      // come back on the next sync. Denying is what keeps it out — and leaves a
      // way back, since re-approving on the response re-syncs it.
      let denied = 0;
      try {
        const r = await markRemoved({
          providerPlaylistId: viewing.id,
          providerTrackId: t.providerTrackId,
        });
        denied = r.denied;
      } catch { /* provider removal already succeeded; do not undo it */ }
      // Keep the table's count honest, same rule as viewing: only when the
      // fetch that produced this list was not truncated.
      if (!capped) {
        setAvailable((prev) => prev?.map(
          (p) => (p.id === viewing.id ? { ...p, trackCount: next.length } : p),
        ) ?? prev);
      }
      announce(
        denied > 0
          ? `Removed ${t.title} from ${viewing.name}, and marked it denied in ${denied} student ${denied === 1 ? 'entry' : 'entries'}.`
          : `Removed ${t.title} from ${viewing.name}.`,
      );
      if (denied > 0) setRemovedNote(`${t.title} — also denied in ${denied} student ${denied === 1 ? 'entry' : 'entries'}.`);
    } catch {
      setTracksError('Could not reach the provider.');
    } finally { setRemoving(null); }
  }

  async function toggle(pl: ProviderPlaylist) {
    const on = chosen.some((c) => c.providerPlaylistId === pl.id);
    await setPlaylists({
      playlists: on
        ? chosen.filter((c) => c.providerPlaylistId !== pl.id)
        : [...chosen, { label: pl.name, providerPlaylistId: pl.id }],
    });
    setSaved(true); setTimeout(() => setSaved(false), 1600);
    announce(on ? `${pl.name} removed from student choices.` : `${pl.name} added to student choices.`);
  }

  async function rename(id: string, label: string) {
    await setPlaylists({
      playlists: chosen.map((c) => (c.providerPlaylistId === id ? { ...c, label } : c)),
    });
  }

  function openCreate() {
    setNewName(''); setNewDesc(''); setCreateError(''); setCreateOpen(true);
  }

  async function createPlaylist(e: React.FormEvent) {
    e.preventDefault();
    if (!provider || !newName.trim()) return;
    setCreating(true); setCreateError('');
    try {
      const res = await fetch('/api/playlists', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, name: newName.trim(), description: newDesc.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data.error ?? 'Could not create the playlist'); return; }
      await setPlaylists({
        playlists: [...chosen, { label: data.playlist.name, providerPlaylistId: data.playlist.id }],
      });
      setCreateOpen(false);
      await load(provider);
      announce(`Created ${data.playlist.name} and offered it to students.`);
    } finally { setCreating(false); }
  }

  if (settings === undefined) {
    return (
      <section className={cn(panel, 'p-6')}>
        <BlockSkeleton lines={3} label="Loading playlist settings" />
      </section>
    );
  }

  if (!provider) {
    return (
      <section className={cn(panel, 'p-6')}>
        <h2 className="text-lg font-medium">No music provider connected</h2>
        <p className="text-sm text-muted mt-1">
          Playlists come from your connected account. Connect one first.
        </p>
        <button type="button" onClick={onGoToSettings} className={cn(btn.primary, 'mt-4')}>
          Go to Settings
        </button>
      </section>
    );
  }

  return (
    <>
      <section className={panel} aria-labelledby="plH">
        <div className="p-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h2 id="plH" className="text-lg font-medium">Playlists on {LABEL[provider]}</h2>
            <p className="text-sm text-muted mt-1 max-w-xl">
              Tick the ones students can choose from. Approved tracks sync into whichever
              one the student picked.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {saved && <span className={badge.clean}><Check className="w-4 h-4" aria-hidden="true" />Saved</span>}
            <button type="button" onClick={() => load(provider)} className={cn(btn.secondary, '!min-h-0 !py-2')}>
              <RefreshCw className="w-4 h-4" aria-hidden="true" /> Refresh
            </button>
            <button type="button" onClick={openCreate} className={btn.primary}>
              <Plus className="w-5 h-5" aria-hidden="true" /> New playlist
            </button>
          </div>
        </div>

        {loading && (
          <div className="overflow-x-auto border-t border-rule">
            <table className={table.root}>
              <caption className="sr-only">Loading your playlists</caption>
              <TableSkeleton columns={['w-6', 'w-44', 'w-40', 'w-10', 'w-32']} rows={4}
                label="Loading playlists" />
            </table>
          </div>
        )}
        {error && (
          <div className="px-6 pb-6">
            <p role="alert" className="text-sm text-bad font-medium">{error}</p>
            <button type="button" onClick={onGoToSettings} className={cn(btn.secondary, 'mt-3')}>
              Go to Settings
            </button>
          </div>
        )}

        {available && (
          <div className="overflow-x-auto border-t border-rule">
            <table className={table.root}>
              <caption className="sr-only">
                Your {LABEL[provider]} playlists, and which students can choose
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={cn(table.th, 'w-px whitespace-nowrap')}>Offer to students</th>
                  <th scope="col" className={table.th}>Playlist</th>
                  <th scope="col" className={table.th}>Students see</th>
                  <th scope="col" className={table.th}>Tracks</th>
                  <th scope="col" className={table.th}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {available.map((pl) => {
                  const picked = chosen.find((c) => c.providerPlaylistId === pl.id);
                  return (
                    <tr key={pl.id} className={picked ? 'bg-indigo-50/40' : undefined}>
                      <td className={cn(table.td, 'text-center')}>
                        <input type="checkbox" className="w-4 h-4" checked={Boolean(picked)}
                          onChange={() => toggle(pl)}
                          aria-label={`Offer ${pl.name} to students`} />
                      </td>
                      <td className={cn(table.td, 'font-medium')}>{pl.name}</td>
                      <td className={table.td}>
                        {picked ? (
                          <>
                            <label htmlFor={`lbl-${pl.id}`} className="sr-only">
                              Name students see for {pl.name}
                            </label>
                            <input id={`lbl-${pl.id}`} className={cn(input.base, '!min-h-0 !py-1.5 !w-56')}
                              defaultValue={picked.label}
                              onBlur={(e) => rename(pl.id, e.target.value.trim() || pl.name)} />
                          </>
                        ) : <span className="text-muted">—</span>}
                      </td>
                      <td className={cn(table.td, 'tabular-nums')}>{pl.trackCount ?? '—'}</td>
                      <td className={cn(table.td, 'text-right')}>
                        <div className="flex justify-end gap-1">
                          <button type="button" onClick={() => openTracks(pl)} className={btn.ghostSm}
                            aria-label={`View songs in ${pl.name}`}>
                            <ListMusic className="w-4 h-4" aria-hidden="true" /> Songs
                          </button>
                          {pl.url && (
                            <a href={pl.url} target="_blank" rel="noopener noreferrer"
                              className={btn.ghostSm} aria-label={`Open ${pl.name} on ${LABEL[provider]}`}>
                              <ExternalLink className="w-4 h-4" aria-hidden="true" /> Open
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {available.length === 0 && (
              <p className="p-6 text-sm text-muted">
                You don&apos;t own any playlists on this account yet. Create one below.
              </p>
            )}
          </div>
        )}

      </section>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)}
        title={`New ${LABEL[provider]} playlist`} labelledBy="create-pl-title">
        <form onSubmit={createPlaylist} noValidate className="space-y-4">
          <div>
            <label htmlFor="pl-name" className="block text-sm font-medium mb-1.5">Name</label>
            <input id="pl-name" data-autofocus className={input.base} value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Period 4 Study Beats" required />
            <p className="text-sm text-muted mt-1.5">
              Students see this name unless you rename it in the table.
            </p>
          </div>
          <div>
            <label htmlFor="pl-desc" className="block text-sm font-medium mb-1.5">
              Description <span className="text-muted font-normal">(optional)</span>
            </label>
            <input id="pl-desc" className={input.base} value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Curated by Period 4 students" />
          </div>

          <p className="text-sm text-muted">
            Created <strong className="text-ink font-medium">private</strong> on {LABEL[provider]} and
            offered to students straight away.
          </p>

          {createError && <p role="alert" className="text-sm text-bad font-medium">{createError}</p>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={() => setCreateOpen(false)} className={btn.secondary}>
              Cancel
            </button>
            <button type="submit" disabled={creating || !newName.trim()} className={btn.primary}>
              {creating ? 'Creating…' : 'Create playlist'}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={viewing !== null} onClose={() => { setViewing(null); setConfirmRemove(null); }} size="lg"
        title={viewing ? `Songs in ${viewing.name}` : 'Songs'} labelledBy="tracks-title">
        {tracksError && <p role="alert" className="text-sm text-bad font-medium">{tracksError}</p>}
        {!tracksError && tracks === null && (
          <div className="border border-rule rounded-lg divide-y divide-slate-100">
            <span role="status" className="sr-only">Loading songs</span>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-2.5" aria-hidden="true">
                <Skeleton className="w-9 h-9 rounded shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        )}
        {tracks?.length === 0 && <p className="text-sm text-muted">This playlist is empty.</p>}
        {tracks && tracks.length > 0 && (
          <>
            <ul className="divide-y divide-slate-100 border border-rule rounded-lg max-h-[55vh] overflow-y-auto">
              {tracks.map((t, i) => (
                <li key={`${t.providerTrackId}-${i}`} className="flex items-center gap-3 p-2.5">
                  <span className="text-sm text-muted tabular-nums w-6 text-right shrink-0">{i + 1}</span>
                  {t.artworkUrl
                    ? <Image src={t.artworkUrl} alt="" width={36} height={36}
                        className={artwork.sm} unoptimized />
                    : <div className={cn(artwork.sm, 'grid place-items-center')} aria-hidden="true">
                        <Music2 className="w-4 h-4 text-slate-400" />
                      </div>}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">{t.title}</span>
                    <span className="block text-sm text-muted truncate">{t.artist}</span>
                  </span>
                  {t.durationSec !== null && (
                    <span className="text-sm text-muted tabular-nums shrink-0">{fmt(t.durationSec)}</span>
                  )}
                  {(() => {
                    const ref = t.playlistItemId ?? t.providerTrackId;
                    const busy = removing === ref;
                    if (confirmRemove === ref) {
                      return (
                        <span className="flex items-center gap-1 shrink-0">
                          <button type="button" onClick={() => removeTrack(t)} disabled={busy}
                            className="px-2 py-1 rounded-lg text-xs font-medium bg-bad text-white hover:bg-rose-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bad">
                            {busy ? 'Removing…' : 'Remove'}
                          </button>
                          <button type="button" onClick={() => setConfirmRemove(null)} disabled={busy}
                            className={cn(btn.ghostSm, '!px-2 !py-1 text-xs')}>
                            Cancel
                          </button>
                        </span>
                      );
                    }
                    return (
                      <button type="button" onClick={() => setConfirmRemove(ref)}
                        aria-label={`Remove ${t.title} from ${viewing?.name ?? 'this playlist'}`}
                        className="shrink-0 p-1.5 rounded-lg text-muted hover:text-bad hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bad">
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    );
                  })()}
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted mt-3">
              Removing a song takes it out of the {LABEL[provider]} playlist and marks it
              denied for any student who picked it, so syncing won&apos;t add it back.
              Re-approve it on that response to bring it back.
            </p>
            {removedNote && (
              <p role="status" className="text-sm text-ink mt-2">{removedNote}</p>
            )}
            {capped && (
              <p className="text-sm text-muted mt-3">
                Showing the first {tracks.length}.{' '}
                {viewing?.url && (
                  <Link href={viewing.url} target="_blank" rel="noopener noreferrer"
                    className="text-accent underline underline-offset-2">
                    Open on {LABEL[provider]}
                  </Link>
                )}{' '}to see the rest.
              </p>
            )}
          </>
        )}
        <div className="flex justify-end pt-5">
          <button type="button" data-autofocus onClick={() => setViewing(null)} className={btn.secondary}>
            Close
          </button>
        </div>
      </Dialog>
    </>
  );
}
