import { NextRequest, NextResponse } from 'next/server';
import {
  searchCatalog, searchSpotifyCatalog, CatalogUnavailableError,
  type CatalogTrack, type CatalogSource,
} from '@/lib/catalog';

/**
 * Reachable by UNAUTHENTICATED students, so it is rate limited per IP.
 * In-memory limiter: fine for a single classroom instance; move to Convex or
 * a shared store if this is ever deployed to more than one node.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 40;
const hits = new Map<string, { count: number; windowStart: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.windowStart > WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (rec.count >= MAX_PER_WINDOW) return true;
  rec.count++;
  return false;
}

export async function GET(req: NextRequest) {
  const term = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!term) {
    return NextResponse.json({ error: 'Missing query' }, { status: 400 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'Too many searches. Slow down a moment.' }, { status: 429 });
  }

  // Search the platform the teacher actually syncs to, when that is Spotify:
  // anything a student picks then provably exists there, and sync writes the
  // exact URI with no lookup. Deezer is the fallback and the YouTube path,
  // because YouTube's search.list costs 100 quota units per call — students
  // searching it would exhaust the 10,000/day budget almost immediately.
  const requested = req.nextUrl.searchParams.get('source');
  const source: CatalogSource = requested === 'spotify' ? 'spotify' : 'deezer';

  try {
    let results: CatalogTrack[];
    let usedSource: CatalogSource = source;

    if (source === 'spotify') {
      try {
        results = await searchSpotifyCatalog(term, 8);
      } catch {
        // Spotify unavailable or unconfigured — fall back rather than block the
        // student. Sync will resolve by ISRC, which is less reliable, so the
        // response says which source answered.
        results = await searchCatalog(term, 8);
        usedSource = 'deezer';
      }
    } else {
      results = await searchCatalog(term, 8);
    }

    return NextResponse.json({ results, source: usedSource });
  } catch (err) {
    // 503 on purpose. NEVER fall back to accepting free text here — that would
    // reintroduce every disambiguation problem the catalog exists to remove.
    if (err instanceof CatalogUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
