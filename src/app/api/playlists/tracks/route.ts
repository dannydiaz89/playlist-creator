import { NextRequest, NextResponse } from 'next/server';
import { getProvider, ProviderAuthError, QuotaExceededError } from '@/lib/providers';
import type { ProviderName } from '@/lib/providers';
import { getProviderAccessToken } from '@/lib/server-auth';
import { isAuthenticated } from '@/lib/convex-server';

function isProvider(v: string | null): v is ProviderName {
  return v === 'spotify' || v === 'youtube';
}

/** Contents of one of the teacher's playlists. Teacher-only. */
export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const provider = req.nextUrl.searchParams.get('provider');
  const playlistId = req.nextUrl.searchParams.get('playlistId');
  if (!isProvider(provider) || !playlistId) {
    return NextResponse.json({ error: 'provider and playlistId are required' }, { status: 400 });
  }

  try {
    const token = await getProviderAccessToken(provider, req.headers.get('cookie') ?? '');
    // Capped: a 500-track playlist should not be paged in full just to preview it.
    const tracks = await getProvider(provider).listTracks(token, playlistId, 100);
    return NextResponse.json({ tracks, capped: tracks.length >= 100 });
  } catch (err) {
    if (err instanceof ProviderAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof QuotaExceededError) return NextResponse.json({ error: err.message }, { status: 429 });
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/** Remove one track from a playlist. Teacher-only. */
export async function DELETE(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !isProvider(body.provider) || !body.playlistId || !body.ref) {
    return NextResponse.json(
      { error: 'provider, playlistId and ref are required' },
      { status: 400 },
    );
  }

  try {
    const token = await getProviderAccessToken(body.provider, req.headers.get('cookie') ?? '');
    await getProvider(body.provider).removeTracks(token, body.playlistId, [body.ref]);
    return NextResponse.json({ removed: 1 });
  } catch (err) {
    if (err instanceof ProviderAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof QuotaExceededError) return NextResponse.json({ error: err.message }, { status: 429 });
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
