'use client';
import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { useMutation } from 'convex/react';
import { Music2 } from 'lucide-react';
import { api } from '@convex/_generated/api';
import type { Doc } from '@convex/_generated/dataModel';
import { Dialog } from '@/components/Dialog';
import { useAnnounce } from '@/components/LiveRegion';
import { artwork, badge, btn, cn, input } from '@/lib/design';
import type { CatalogTrack } from '@/lib/catalog';
import type { ProviderName } from '@/lib/providers';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Accepts a Spotify URI, an open.spotify.com link, or a bare id. */
function parseSpotifyId(raw: string): string | null {
  const v = raw.trim();
  if (/^spotify:track:[A-Za-z0-9]+$/.test(v)) return v;
  const url = /open\.spotify\.com\/track\/([A-Za-z0-9]+)/.exec(v);
  if (url) return `spotify:track:${url[1]}`;
  if (/^[A-Za-z0-9]{22}$/.test(v)) return `spotify:track:${v}`;
  return null;
}

/** Accepts a YouTube watch/short link or a bare 11-character video id. */
function parseYouTubeId(raw: string): string | null {
  const v = raw.trim();
  const m = /(?:v=|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{11})/.exec(v);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
  return null;
}

export function ResolveTrackDialog({
  group, provider, open, onClose,
}: {
  /**
   * Every song row sharing this track. Sync de-duplicates them, so they must be
   * matched together — resolving one would split the group and risk adding the
   * same song twice.
   */
  group: Doc<'songs'>[] | null;
  provider: ProviderName;
  open: boolean;
  onClose: () => void;
}) {
  const announce = useAnnounce();
  const resolve = useMutation(api.songs.resolveProviderTrack);

  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<CatalogTrack[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [manual, setManual] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const song = group?.[0] ?? null;

  // Seed the query from what the student actually asked for.
  useEffect(() => {
    if (open && song) {
      setTerm(`${song.title} ${song.artist}`.trim());
      setHits(null); setManual(''); setError('');
    }
  }, [open, song]);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setSearching(true); setError(''); setHits(null);
    try {
      const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(q)}&source=spotify`);
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Search failed'); return; }
      if (data.source !== 'spotify') {
        // Fell back to Deezer, whose results carry no Spotify URI — picking one
        // would leave the song exactly as unresolvable as it already is.
        setError('Spotify search is unavailable right now. Paste a track link instead.');
        return;
      }
      setHits(data.results);
      announce(`${data.results.length} results.`);
    } catch {
      setError('Could not reach the search service.');
    } finally { setSearching(false); }
  }, [announce]);

  async function save(providerTrackId: string, label: string) {
    if (!group?.length) return;
    setSaving(true); setError('');
    try {
      const { updated } = await resolve({
        songIds: group.map((g) => g._id),
        providerTrackId,
        providerTrackTitle: label,
      });
      announce(
        updated > 1
          ? `Matched to ${label} for all ${updated} students who picked it.`
          : `Matched to ${label}.`,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the match.');
    } finally { setSaving(false); }
  }

  function saveManual() {
    const id = provider === 'spotify' ? parseSpotifyId(manual) : parseYouTubeId(manual);
    if (!id) {
      setError(provider === 'spotify'
        ? 'Paste a Spotify track link, URI, or id.'
        : 'Paste a YouTube video link or id.');
      return;
    }
    save(id, manual.trim());
  }

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Find this track" labelledBy="resolve-title">
      {song && group && (
        <div className="space-y-5">
          <div>
            <p className="text-sm text-muted">
              {group.length > 1
                ? `${group.length} students asked for`
                : 'The student asked for'}
            </p>
            <p className="text-sm font-medium">{song.title}</p>
            <p className="text-sm text-muted">{song.artist}</p>
            {group.length > 1 && (
              <p className="text-sm text-muted mt-2">
                Matching this applies to all {group.length} of their entries, so it still
                syncs as one track.
              </p>
            )}
            {song.providerTrackTitle && (
              <p className="text-sm text-muted mt-2">
                Currently matched to <span className="text-ink">{song.providerTrackTitle}</span>
              </p>
            )}
          </div>

          {provider === 'spotify' && (
            <div className="pt-5 border-t border-rule">
              <label htmlFor="resolve-q" className="block text-sm font-medium mb-1.5">
                Search Spotify
              </label>
              <div className="flex flex-wrap gap-2">
                <input id="resolve-q" data-autofocus className={cn(input.base, 'flex-1 min-w-[12rem]')}
                  value={term} onChange={(e) => setTerm(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(term); } }} />
                <button type="button" onClick={() => runSearch(term)}
                  disabled={searching} className={btn.secondary}>
                  {searching ? 'Searching…' : 'Search'}
                </button>
              </div>

              {hits && hits.length === 0 && (
                <p className="text-sm text-muted mt-3">
                  Nothing found. Try a different wording, or paste a link below.
                </p>
              )}

              {hits && hits.length > 0 && (
                <ul className="mt-3 divide-y divide-slate-100 border border-rule rounded-lg max-h-72 overflow-y-auto">
                  {hits.map((t) => (
                    <li key={t.providerTrackId ?? t.title}>
                      <button type="button" disabled={saving}
                        onClick={() => save(t.providerTrackId!, `${t.title} — ${t.artist}`)}
                        className="w-full flex items-center gap-3 p-2.5 text-left hover:bg-slate-50 disabled:opacity-50">
                        {t.artworkUrl
                          ? <Image src={t.artworkUrl} alt="" width={36} height={36}
                              className={artwork.sm} unoptimized />
                          : <div className={artwork.sm} />}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium truncate">{t.title}</span>
                          <span className="block text-sm text-muted truncate">
                            {t.artist} · {fmt(t.durationSec)}
                          </span>
                        </span>
                        {t.isExplicit && <span className={cn(badge.flagged, 'shrink-0')}>Explicit</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="pt-5 border-t border-rule">
            <label htmlFor="resolve-manual" className="block text-sm font-medium mb-1.5">
              {provider === 'spotify' ? 'Or paste a Spotify track link' : 'Paste a YouTube video link'}
            </label>
            <div className="flex flex-wrap gap-2">
              <input id="resolve-manual" className={cn(input.base, 'flex-1 min-w-[12rem]')}
                value={manual} onChange={(e) => setManual(e.target.value)}
                placeholder={provider === 'spotify'
                  ? 'https://open.spotify.com/track/…'
                  : 'https://www.youtube.com/watch?v=…'} />
              <button type="button" onClick={saveManual} disabled={saving || !manual.trim()}
                className={btn.secondary}>Use this</button>
            </div>
            {provider === 'youtube' && (
              <p className="text-sm text-muted mt-1.5">
                Pasting a link avoids a YouTube search, which costs 100 of the 10,000 daily
                API units.
              </p>
            )}
          </div>

          {error && <p role="alert" className="text-sm text-bad font-medium">{error}</p>}

          <div className="flex justify-end pt-2">
            <button type="button" onClick={onClose} className={btn.secondary}>Cancel</button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
