import { NextRequest, NextResponse } from 'next/server';
import { getProvider, ProviderAuthError, QuotaExceededError } from '@/lib/providers';
import type { ProviderName } from '@/lib/providers';
import { getProviderAccessToken } from '@/lib/server-auth';

function isProvider(v: string | null): v is ProviderName {
  return v === 'spotify' || v === 'youtube';
}

/** List the teacher's playlists. Required on BOTH providers so a teacher can
 *  switch without losing the ability to target playlists. */
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('provider');
  if (!isProvider(name)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
  }
  try {
    const token = await getProviderAccessToken(name, req.headers.get('cookie') ?? '');
    const all = await getProvider(name).listPlaylists(token);

    // Only playlists the account OWNS are usable: a followed playlist can be
    // neither read nor written through the API, so listing one would only offer
    // a choice that always fails.
    const playlists = all.filter((p) => p.isOwned);
    return NextResponse.json({ playlists });
  } catch (err) {
    if (err instanceof ProviderAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof QuotaExceededError) return NextResponse.json({ error: err.message }, { status: 429 });
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/** Create a playlist and read it straight back so it can be linked immediately. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || !isProvider(body.provider) || !body.name?.trim()) {
    return NextResponse.json({ error: 'provider and name are required' }, { status: 400 });
  }
  try {
    const token = await getProviderAccessToken(body.provider, req.headers.get('cookie') ?? '');
    const playlist = await getProvider(body.provider).createPlaylist(
      token, body.name.trim(), body.description,
    );
    return NextResponse.json({ playlist });
  } catch (err) {
    if (err instanceof ProviderAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof QuotaExceededError) return NextResponse.json({ error: err.message }, { status: 429 });
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
