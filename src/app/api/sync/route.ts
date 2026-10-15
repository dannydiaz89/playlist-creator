import { NextRequest, NextResponse } from 'next/server';
import { api } from '@convex/_generated/api';
import type { Id, Doc } from '@convex/_generated/dataModel';
import { syncApproved, type SyncSong } from '@/lib/sync';
import { getProvider, ProviderAuthError, QuotaExceededError } from '@/lib/providers';
import type { ProviderName, ResolvedTrack } from '@/lib/providers';
import { getProviderAccessToken } from '@/lib/server-auth';
import { isAuthenticated, fetchAuthQuery, fetchAuthMutation } from '@/lib/convex-server';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.surveyId || (body.provider !== 'spotify' && body.provider !== 'youtube')) {
    return NextResponse.json({ error: 'surveyId and provider are required' }, { status: 400 });
  }
  const provider = body.provider as ProviderName;

  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // fetchAuthQuery/Mutation carry the Convex JWT, so identity reaches every
  // function and each one re-checks ownership. This route being reachable is
  // not authorization.

  try {
    const songs = await fetchAuthQuery(api.songs.listApprovedForSync, {
      surveyId: body.surveyId as Id<'surveys'>,
      submissionId: body.submissionId as Id<'submissions'> | undefined,
    });
    if (!songs.length) {
      return NextResponse.json({ error: 'No approved tracks to sync' }, { status: 400 });
    }

    const survey = await fetchAuthQuery(api.surveys.get, { surveyId: body.surveyId as Id<'surveys'> });

    // A providerPlaylistId is only valid for the account that issued it.
    const targets = new Map<string, string>();
    for (const p of survey.allowedPlaylists as Doc<'surveys'>['allowedPlaylists']) {
      if (p.providerPlaylistId) targets.set(p.label, p.providerPlaylistId);
    }
    const usedTargets: string[] = songs.map((s: Doc<'songs'>) => s.playlistTarget);
    const unlinked = [...new Set(usedTargets)].filter((t) => !targets.has(t));
    if (targets.size === 0) {
      return NextResponse.json(
        { error: 'Link your playlists to this class before syncing.' },
        { status: 400 },
      );
    }

    const token = await getProviderAccessToken(provider, req.headers.get('cookie') ?? '');

    const outcome = await syncApproved({
      provider,
      token,
      songs: songs.map((s: Doc<'songs'>): SyncSong => ({
        _id: s._id, title: s.title, artist: s.artist, isrc: s.isrc,
        providerTrackId: s.providerTrackId ?? null,
        durationSec: s.durationSec, playlistTarget: s.playlistTarget, source: s.source,
      })),
      targets,
      deps: {
        async getCached(isrc, p) {
          const row = await fetchAuthQuery(api.songs.getResolution, { isrc, provider: p });
          if (!row) return null;
          return {
            providerTrackId: row.providerTrackId,
            title: row.title,
            durationSec: row.durationSec,
            confidence: row.confidence,
          } satisfies ResolvedTrack;
        },
        async saveCached(isrc, p, r) {
          await fetchAuthMutation(api.songs.saveResolution, {
            isrc, provider: p, providerTrackId: r.providerTrackId,
            title: r.title, durationSec: r.durationSec, confidence: r.confidence,
          });
        },
        async markSynced(songIds, uri) {
          await fetchAuthMutation(api.songs.markSynced, {
            songIds: songIds as Id<'songs'>[], syncedTrackUri: uri,
          });
        },
      },
    });

    return NextResponse.json({
      ...outcome,
      unlinkedTargets: unlinked,
      providerName: getProvider(provider).displayName,
      // Surfaced so the UI can warn before the teacher trusts the result.
      matchConfidence: getProvider(provider).matchConfidence,
    }, {
      // 207 when the job stopped early: the client must not render this as success.
      status: outcome.quotaExhausted ? 207 : 200,
    });
  } catch (err) {
    if (err instanceof ProviderAuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof QuotaExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
