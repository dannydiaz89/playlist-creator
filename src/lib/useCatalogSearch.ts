'use client';
import { useState, useRef, useCallback } from 'react';
import type { CatalogTrack } from '@/lib/catalog';

export type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'results'; hits: CatalogTrack[] }
  | { kind: 'empty' }
  | { kind: 'unavailable'; message: string };

export function useCatalogSearch(source: 'spotify' | 'deezer' = 'deezer') {
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0);

  const search = useCallback((term: string) => {
    clearTimeout(timer.current);
    if (term.trim().length < 2) { setState({ kind: 'idle' }); return; }
    setState({ kind: 'searching' });
    const mine = ++seq.current;

    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/catalog/search?q=${encodeURIComponent(term)}&source=${source}`,
        );
        if (mine !== seq.current) return; // a newer keystroke won
        if (res.status === 503) {
          const { error } = await res.json();
          setState({ kind: 'unavailable', message: error });
          return;
        }
        if (!res.ok) { setState({ kind: 'unavailable', message: 'Search failed.' }); return; }
        const { results } = await res.json();
        setState(results.length ? { kind: 'results', hits: results } : { kind: 'empty' });
      } catch {
        if (mine === seq.current) {
          setState({ kind: 'unavailable', message: 'Could not reach the music catalog.' });
        }
      }
    }, 250);
  }, [source]);

  const reset = useCallback(() => {
    clearTimeout(timer.current);
    seq.current++;
    setState({ kind: 'idle' });
  }, []);

  return { state, search, reset };
}

/** Search omits the ISRC; only the detail endpoint has it, and sync needs it. */
export async function fetchTrackDetail(deezerId: number): Promise<CatalogTrack> {
  const res = await fetch(`/api/catalog/track?id=${deezerId}`);
  if (!res.ok) throw new Error('Could not load track details');
  const { track } = await res.json();
  return track;
}
