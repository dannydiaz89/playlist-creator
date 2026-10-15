import { NextRequest, NextResponse } from 'next/server';
import { getCatalogTrack, CatalogUnavailableError } from '@/lib/catalog';

/** Fetches full track detail — notably the ISRC, which search does not return. */
export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid track id' }, { status: 400 });
  }
  try {
    return NextResponse.json({ track: await getCatalogTrack(id) });
  } catch (err) {
    if (err instanceof CatalogUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
