import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { requireTeacher, requireOwnedSurvey, requireOwnedSong } from './lib/auth';

export const updateDecision = mutation({
  args: {
    songId: v.id('songs'),
    decision: v.union(v.literal('pending'), v.literal('approved'), v.literal('denied')),
    denialReason: v.optional(v.string()),
  },
  handler: async (ctx, { songId, decision, denialReason }) => {
    const teacherId = await requireTeacher(ctx);
    const song = await requireOwnedSong(ctx, songId);

    await ctx.db.patch(songId, {
      decision,
      denialReason: decision === 'denied' ? denialReason : undefined,
      decidedAt: Date.now(),
      decidedBy: teacherId,
      // The audit trail: records that a human knowingly approved a track the
      // pre-check flagged. This is what protects the teacher afterwards.
      teacherOverride: decision === 'approved' && song.preScreen.status !== 'clean',
    });
  },
});

/**
 * Approves ONLY status === "clean". Never flagged, never unverified.
 *
 * A manual row has no explicit flag, so treating its absence as clean would
 * fail open — the same mistake as the iTunes explicit bug, through the front door.
 */
export const bulkApproveClean = mutation({
  args: { surveyId: v.id('surveys'), submissionId: v.optional(v.id('submissions')) },
  handler: async (ctx, { surveyId, submissionId }) => {
    const teacherId = await requireTeacher(ctx);
    await requireOwnedSurvey(ctx, surveyId);

    const songs = submissionId
      ? await ctx.db
          .query('songs')
          .withIndex('by_submission', (q) => q.eq('submissionId', submissionId))
          .collect()
      : await ctx.db
          .query('songs')
          .withIndex('by_survey', (q) => q.eq('surveyId', surveyId))
          .collect();

    // Anything this teacher denied before, anywhere in their classes. Approving
    // it in bulk would quietly reverse that decision.
    const previouslyDenied = new Set<string>();
    const mySurveys = await ctx.db
      .query('surveys')
      .withIndex('by_teacher', (q) => q.eq('teacherId', teacherId))
      .collect();
    for (const sv of mySurveys) {
      const all = await ctx.db
        .query('songs')
        .withIndex('by_survey', (q) => q.eq('surveyId', sv._id))
        .collect();
      for (const x of all) {
        if (x.decision !== 'denied') continue;
        if (x.providerTrackId) previouslyDenied.add(x.providerTrackId);
        if (x.isrc) previouslyDenied.add(x.isrc);
      }
    }

    let approved = 0;
    let skippedPreviouslyDenied = 0;
    for (const song of songs) {
      if (song.preScreen.status !== 'clean' || song.decision !== 'pending') continue;
      if (
        (song.providerTrackId && previouslyDenied.has(song.providerTrackId)) ||
        (song.isrc && previouslyDenied.has(song.isrc))
      ) {
        skippedPreviouslyDenied++;
        continue;
      }
      await ctx.db.patch(song._id, {
        decision: 'approved',
        decidedAt: Date.now(),
        decidedBy: teacherId,
        teacherOverride: false,
      });
      approved++;
    }
    return { approved, skippedPreviouslyDenied };
  },
});

export const listApprovedForSync = query({
  args: { surveyId: v.id('surveys'), submissionId: v.optional(v.id('submissions')) },
  handler: async (ctx, { surveyId, submissionId }) => {
    await requireOwnedSurvey(ctx, surveyId);
    const songs = submissionId
      ? await ctx.db
          .query('songs')
          .withIndex('by_submission', (q) => q.eq('submissionId', submissionId))
          .collect()
      : await ctx.db
          .query('songs')
          .withIndex('by_survey', (q) => q.eq('surveyId', surveyId))
          .collect();
    return songs.filter((s) => s.decision === 'approved' && !s.isSynced);
  },
});

export const markSynced = mutation({
  args: {
    songIds: v.array(v.id('songs')),
    syncedTrackUri: v.optional(v.string()),
  },
  handler: async (ctx, { songIds, syncedTrackUri }) => {
    for (const songId of songIds) {
      await requireOwnedSong(ctx, songId);
      await ctx.db.patch(songId, { isSynced: true, syncedTrackUri });
    }
  },
});

// --- trackResolutions cache ------------------------------------------------
// Deployment-wide. On YouTube a cache hit costs 0 search units (vs 100), which
// is what keeps a class-sized sync inside the 10,000 units/day quota.

export const getResolution = query({
  args: { isrc: v.string(), provider: v.union(v.literal('spotify'), v.literal('youtube')) },
  handler: async (ctx, { isrc, provider }) => {
    await requireTeacher(ctx);
    return await ctx.db
      .query('trackResolutions')
      .withIndex('by_isrc_provider', (q) => q.eq('isrc', isrc).eq('provider', provider))
      .unique();
  },
});

export const saveResolution = mutation({
  args: {
    isrc: v.string(),
    provider: v.union(v.literal('spotify'), v.literal('youtube')),
    providerTrackId: v.string(),
    title: v.string(),
    durationSec: v.union(v.number(), v.null()),
    confidence: v.union(v.literal('exact'), v.literal('fuzzy')),
  },
  handler: async (ctx, args) => {
    await requireTeacher(ctx);
    const existing = await ctx.db
      .query('trackResolutions')
      .withIndex('by_isrc_provider', (q) =>
        q.eq('isrc', args.isrc).eq('provider', args.provider),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, resolvedAt: Date.now() });
      return existing._id;
    }
    return await ctx.db.insert('trackResolutions', { ...args, resolvedAt: Date.now() });
  },
});

/**
 * Point songs at an exact provider track, by hand.
 *
 * Takes a LIST, not one id: sync de-duplicates rows that share a track, so when
 * several students picked the same song the teacher is matching all of them at
 * once. Resolving only one would split the group — the matched row syncing by
 * URI and the rest by ISRC lookup — which can add the same song twice.
 *
 * The students' original `title`/`artist` are deliberately left alone: this
 * records what the teacher matched their request to, not a rewrite of it.
 */
export const resolveProviderTrack = mutation({
  args: {
    songIds: v.array(v.id('songs')),
    providerTrackId: v.string(),
    providerTrackTitle: v.string(),
  },
  handler: async (ctx, { songIds, providerTrackId, providerTrackTitle }) => {
    const teacherId = await requireTeacher(ctx);
    if (songIds.length === 0) throw new Error('No songs to resolve');
    if (!providerTrackId.trim()) throw new Error('A provider track id is required');

    let updated = 0;
    for (const songId of songIds) {
      const song = await requireOwnedSong(ctx, songId);
      // Skip anything already written rather than failing the whole batch: one
      // student's copy being synced should not block matching the others.
      if (song.isSynced) continue;
      await ctx.db.patch(songId, {
        providerTrackId: providerTrackId.trim(),
        providerTrackTitle: providerTrackTitle.trim() || undefined,
        resolvedBy: teacherId,
        resolvedAt: Date.now(),
      });
      updated++;
    }
    if (updated === 0) throw new Error('Those tracks have already been synced');
    return { updated };
  },
});

/** Undo a manual match, returning the song to automatic lookup. */
export const clearProviderTrack = mutation({
  args: { songIds: v.array(v.id('songs')) },
  handler: async (ctx, { songIds }) => {
    for (const songId of songIds) {
      const song = await requireOwnedSong(ctx, songId);
      if (song.isSynced) continue;
      await ctx.db.patch(songId, {
        providerTrackId: null,
        providerTrackTitle: undefined,
        resolvedBy: undefined,
        resolvedAt: undefined,
      });
    }
  },
});

/**
 * Record that a track was removed from a provider playlist.
 *
 * Removing a song has to be STICKY, or the next sync silently puts it back and
 * the teacher's action is undone. But leaving `isSynced: true` to achieve that
 * makes the flag lie — the track is no longer in the playlist.
 *
 * So removal is recorded honestly instead: `isSynced` goes false (it really is
 * gone) and the decision becomes `denied` (that is what keeps it out). The
 * teacher gets a way back too — re-approve it on the response and the next sync
 * adds it again.
 *
 * Scoped to this teacher's surveys that actually target the playlist, so
 * removing from one class cannot reach into another.
 */
export const markRemovedFromPlaylist = mutation({
  args: { providerPlaylistId: v.string(), providerTrackId: v.string() },
  handler: async (ctx, { providerPlaylistId, providerTrackId }) => {
    const teacherId = await requireTeacher(ctx);

    const surveys = await ctx.db
      .query('surveys')
      .withIndex('by_teacher', (q) => q.eq('teacherId', teacherId))
      .collect();
    const targeted = surveys.filter((s) =>
      s.allowedPlaylists.some((p) => p.providerPlaylistId === providerPlaylistId),
    );

    let denied = 0;
    for (const survey of targeted) {
      const songs = await ctx.db
        .query('songs')
        .withIndex('by_survey', (q) => q.eq('surveyId', survey._id))
        .collect();
      for (const song of songs) {
        if (song.providerTrackId !== providerTrackId) continue;
        await ctx.db.patch(song._id, {
          isSynced: false,
          syncedTrackUri: undefined,
          decision: 'denied',
          denialReason: 'Removed from the playlist',
          decidedAt: Date.now(),
          decidedBy: teacherId,
          teacherOverride: false,
        });
        denied++;
      }
    }
    // Zero is normal: the teacher may have added that track to the playlist
    // themselves, with no student submission behind it.
    return { denied };
  },
});

/**
 * Prior denials of the tracks in a submission.
 *
 * Without this, a track the teacher already rejected comes back through another
 * student looking completely clean — "No flags, needs review" — and approving it
 * silently undoes the earlier decision. That is sharpest after a playlist
 * removal: remove a song, another student submits it, it goes straight back in.
 *
 * Advisory only, like the pre-checks: it informs the teacher, it never blocks.
 * Matches on the provider track id OR the ISRC, since the same recording can
 * arrive under either depending on which catalog the student searched.
 */
export const priorDenials = query({
  args: { submissionId: v.id('submissions') },
  handler: async (ctx, { submissionId }) => {
    const teacherId = await requireTeacher(ctx);
    const submission = await ctx.db.get(submissionId);
    if (!submission) throw new Error('Submission not found');
    await requireOwnedSurvey(ctx, submission.surveyId);

    const theseSongs = await ctx.db
      .query('songs')
      .withIndex('by_submission', (q) => q.eq('submissionId', submissionId))
      .collect();

    const surveys = await ctx.db
      .query('surveys')
      .withIndex('by_teacher', (q) => q.eq('teacherId', teacherId))
      .collect();

    const denied: { uri: string | null; isrc: string | null; reason?: string; at?: number }[] = [];
    for (const survey of surveys) {
      const songs = await ctx.db
        .query('songs')
        .withIndex('by_survey', (q) => q.eq('surveyId', survey._id))
        .collect();
      for (const song of songs) {
        if (song.decision !== 'denied') continue;
        if (song.submissionId === submissionId) continue; // not "prior" to itself
        denied.push({
          uri: song.providerTrackId ?? null,
          isrc: song.isrc ?? null,
          reason: song.denialReason,
          at: song.decidedAt,
        });
      }
    }

    const out: Record<string, { count: number; reason?: string; at?: number }> = {};
    for (const song of theseSongs) {
      const matches = denied.filter(
        (d) =>
          (song.providerTrackId && d.uri === song.providerTrackId) ||
          (song.isrc && d.isrc === song.isrc),
      );
      if (!matches.length) continue;
      const latest = matches.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0];
      out[song._id] = { count: matches.length, reason: latest.reason, at: latest.at };
    }
    return out;
  },
});
