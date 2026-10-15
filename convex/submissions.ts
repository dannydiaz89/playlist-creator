import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { requireTeacher, requireOwnedSurvey } from './lib/auth';
import { enforceRateLimit } from './lib/rateLimit';
import { screenTrack } from './lib/screening';
import { normaliseCode } from './lib/surveyCode';

export const MAX_SONGS = 10;
export const MAX_MANUAL = 2;

const songInput = v.object({
  source: v.union(v.literal('catalog'), v.literal('manual')),
  title: v.string(),
  artist: v.string(),
  isrc: v.union(v.string(), v.null()),
  deezerId: v.union(v.number(), v.null()),
  providerTrackId: v.optional(v.union(v.string(), v.null())),
  durationSec: v.union(v.number(), v.null()),
  artworkUrl: v.union(v.string(), v.null()),
  isExplicit: v.boolean(),
  playlistTarget: v.string(),
  answers: v.record(v.string(), v.string()),
});

/**
 * TIER 2 — student, unauthenticated.
 * Every rule below is enforced HERE, not in the UI. A closed survey must be
 * unwritable via a direct Convex call.
 */
export const submit = mutation({
  args: {
    code: v.string(),
    studentName: v.string(),
    studentSeat: v.optional(v.string()),
    answers: v.record(v.string(), v.string()),
    songs: v.array(songInput),
    clientKey: v.string(), // per-browser key; coarse but better than nothing
  },
  handler: async (ctx, args) => {
    const survey = await ctx.db
      .query('surveys')
      .withIndex('by_code', (q) => q.eq('code', normaliseCode(args.code)))
      .unique();

    if (!survey) throw new Error('Class code not found');
    if (!survey.isActive) throw new Error('This survey is closed');

    await enforceRateLimit(ctx, `submit:${survey._id}:${args.clientKey}`, 5, 10 * 60 * 1000);

    if (!args.studentName.trim()) throw new Error('Your name is required');
    if (args.songs.length < 1) throw new Error('Add at least one song');
    if (args.songs.length > MAX_SONGS) throw new Error(`At most ${MAX_SONGS} songs`);

    const manualCount = args.songs.filter((s) => s.source === 'manual').length;
    if (manualCount > MAX_MANUAL) {
      throw new Error(`At most ${MAX_MANUAL} songs can be requested manually`);
    }

    const validLabels = new Set(survey.allowedPlaylists.map((p) => p.label));

    for (const song of args.songs) {
      if (!song.title.trim() || !song.artist.trim()) {
        throw new Error('Every song needs a title and an artist');
      }
      // A catalog row must carry real catalog identity: either the provider's
      // own track URI (picked from that provider's catalog) or an ISRC.
      // Otherwise free text sneaks back in and the disambiguation problem
      // returns. deezerId is no longer required — Spotify picks have none.
      if (song.source === 'catalog' && !song.isrc && !song.providerTrackId) {
        throw new Error('Catalog songs must include an ISRC or a provider track id');
      }
      if (!validLabels.has(song.playlistTarget)) {
        throw new Error(`Unknown playlist target: ${song.playlistTarget}`);
      }
    }

    const screened = args.songs.map((s) => ({
      song: s,
      preScreen: screenTrack({
        title: s.title,
        artist: s.artist,
        isExplicit: s.isExplicit,
        source: s.source,
      }),
    }));

    const questions = survey.questions.filter((q) => !q.archived);
    const songQuestions = questions.filter((q) => q.scope === 'song');
    const subQuestions = questions.filter((q) => q.scope === 'submission');

    for (const q of subQuestions) {
      const a = (args.answers[q.id] ?? '').trim();
      if (q.required && !a) throw new Error(`"${q.label}" is required`);
      if (a.length > q.maxLength) throw new Error(`"${q.label}" is too long`);
    }

    screened.forEach(({ song, preScreen }, i) => {
      // Escalation: a flagged or unverified track must be explained regardless
      // of what the teacher marked optional.
      const forced = preScreen.status !== 'clean';
      songQuestions.forEach((q, qi) => {
        const a = (song.answers[q.id] ?? '').trim();
        if ((q.required || (forced && qi === 0)) && !a) {
          throw new Error(`Song ${i + 1}: "${q.label}" is required`);
        }
        if (a.length > q.maxLength) throw new Error(`Song ${i + 1}: "${q.label}" is too long`);
      });
      if (forced && songQuestions.length === 0) {
        const first = subQuestions[0];
        if (first && !(args.answers[first.id] ?? '').trim()) {
          throw new Error('Please explain your flagged song in the note');
        }
      }
    });

    const now = Date.now();
    const submissionId = await ctx.db.insert('submissions', {
      surveyId: survey._id,
      studentName: args.studentName.trim(),
      studentSeat: args.studentSeat?.trim() || undefined,
      answers: args.answers,
      createdAt: now,
    });

    for (const { song, preScreen } of screened) {
      await ctx.db.insert('songs', {
        submissionId,
        surveyId: survey._id,
        source: song.source,
        title: song.title.trim(),
        artist: song.artist.trim(),
        isrc: song.isrc ? song.isrc.toUpperCase().replace(/-/g, '') : null,
        deezerId: song.deezerId,
        providerTrackId: song.providerTrackId ?? null,
        durationSec: song.durationSec,
        artworkUrl: song.artworkUrl,
        playlistTarget: song.playlistTarget,
        answers: song.answers,
        preScreen,
        decision: 'pending',
        isSynced: false,
        createdAt: now,
      });
    }

    return { submissionId, songCount: screened.length };
  },
});

/** TIER 1 — teacher, ownership-checked. Students must never read these. */
export const listBySurvey = query({
  args: { surveyId: v.id('surveys') },
  handler: async (ctx, { surveyId }) => {
    await requireOwnedSurvey(ctx, surveyId);
    const submissions = await ctx.db
      .query('submissions')
      .withIndex('by_survey', (q) => q.eq('surveyId', surveyId))
      .order('desc')
      .collect();

    return await Promise.all(
      submissions.map(async (s) => {
        const songs = await ctx.db
          .query('songs')
          .withIndex('by_submission', (q) => q.eq('submissionId', s._id))
          .collect();
        return {
          ...s,
          songCount: songs.length,
          flaggedCount: songs.filter((x) => x.preScreen.status !== 'clean').length,
          pendingCount: songs.filter((x) => x.decision === 'pending').length,
          syncedCount: songs.filter((x) => x.isSynced).length,
        };
      }),
    );
  },
});

export const listForTeacher = query({
  args: {},
  handler: async (ctx) => {
    const teacherId = await requireTeacher(ctx);
    const surveys = await ctx.db
      .query('surveys')
      .withIndex('by_teacher', (q) => q.eq('teacherId', teacherId))
      .collect();

    const out = [];
    for (const survey of surveys) {
      const submissions = await ctx.db
        .query('submissions')
        .withIndex('by_survey', (q) => q.eq('surveyId', survey._id))
        .order('desc')
        .collect();
      for (const s of submissions) {
        const songs = await ctx.db
          .query('songs')
          .withIndex('by_submission', (q) => q.eq('submissionId', s._id))
          .collect();
        out.push({
          _id: s._id,
          studentName: s.studentName,
          studentSeat: s.studentSeat,
          createdAt: s.createdAt,
          surveyCode: survey.code,
          className: survey.className,
          songCount: songs.length,
          flaggedCount: songs.filter((x) => x.preScreen.status !== 'clean').length,
          pendingCount: songs.filter((x) => x.decision === 'pending').length,
          syncedCount: songs.filter((x) => x.isSynced).length,
        });
      }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getById = query({
  args: { submissionId: v.id('submissions') },
  handler: async (ctx, { submissionId }) => {
    const submission = await ctx.db.get(submissionId);
    if (!submission) throw new Error('Submission not found');
    const survey = await requireOwnedSurvey(ctx, submission.surveyId);
    const songs = await ctx.db
      .query('songs')
      .withIndex('by_submission', (q) => q.eq('submissionId', submissionId))
      .collect();
    return { submission, survey, songs };
  },
});
