import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { requireTeacher, requireOwnedSurvey } from './lib/auth';
import { questionValidator, playlistTargetValidator } from './schema';
import { generateSurveyCode, normaliseCode, isValidCode } from './lib/surveyCode';

/** TIER 1 — teacher. Scoped to the caller; never returns all surveys. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const teacherId = await requireTeacher(ctx);
    return await ctx.db
      .query('surveys')
      .withIndex('by_teacher', (q) => q.eq('teacherId', teacherId))
      .order('desc')
      .collect();
  },
});

export const get = query({
  args: { surveyId: v.id('surveys') },
  handler: async (ctx, { surveyId }) => await requireOwnedSurvey(ctx, surveyId),
});

/**
 * TIER 2 — student, unauthenticated.
 *
 * Returns a NARROW PROJECTION only. Never teacherId, never providerPlaylistId,
 * never submissions. A leak here re-opens the whole hole through the student
 * door, since the class code is public (it is written on a whiteboard).
 */
export const getByCode = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const survey = await ctx.db
      .query('surveys')
      .withIndex('by_code', (q) => q.eq('code', normaliseCode(code)))
      .unique();
    if (!survey) return null;
    return {
      className: survey.className,
      code: survey.code,
      isActive: survey.isActive,
      // Which catalog the student should search. Safe to expose: it names a
      // search backend, not an account or a playlist id.
      provider: survey.provider,
      playlistLabels: survey.allowedPlaylists.map((p) => p.label),
      questions: survey.questions.filter((q) => !q.archived),
    };
  },
});

export const create = mutation({
  args: {
    className: v.string(),
    code: v.optional(v.string()),
    questions: v.array(questionValidator),
    allowedPlaylists: v.array(playlistTargetValidator),
    provider: v.union(v.literal('spotify'), v.literal('youtube'), v.null()),
  },
  handler: async (ctx, args) => {
    const teacherId = await requireTeacher(ctx);

    let code = args.code ? normaliseCode(args.code) : generateSurveyCode();
    if (!isValidCode(code)) throw new Error('Invalid join code format');

    // Convex mutations are serializable, so check-then-insert is safe here
    // despite the absence of unique constraints.
    for (let attempt = 0; attempt < 8; attempt++) {
      const clash = await ctx.db
        .query('surveys')
        .withIndex('by_code', (q) => q.eq('code', code))
        .unique();
      if (!clash) break;
      if (args.code) throw new Error('That join code is already in use');
      code = generateSurveyCode();
    }

    if (!args.className.trim()) throw new Error('Class name is required');

    return await ctx.db.insert('surveys', {
      teacherId,
      code,
      className: args.className.trim(),
      questions: args.questions,
      allowedPlaylists: args.allowedPlaylists,
      provider: args.provider,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

export const toggleStatus = mutation({
  args: { surveyId: v.id('surveys') },
  handler: async (ctx, { surveyId }) => {
    const survey = await requireOwnedSurvey(ctx, surveyId);
    await ctx.db.patch(surveyId, { isActive: !survey.isActive });
    return !survey.isActive;
  },
});

/**
 * Edit a survey after creation.
 *
 * The join code is deliberately NOT editable: students already have it, and
 * changing it silently breaks every link and whiteboard already shared.
 */
export const update = mutation({
  args: {
    surveyId: v.id('surveys'),
    className: v.optional(v.string()),
    allowedPlaylists: v.optional(v.array(playlistTargetValidator)),
    questions: v.optional(v.array(questionValidator)),
  },
  handler: async (ctx, args) => {
    const survey = await requireOwnedSurvey(ctx, args.surveyId);
    const patch: Record<string, unknown> = {};

    if (args.className !== undefined) {
      if (!args.className.trim()) throw new Error('Class name is required');
      patch.className = args.className.trim();
    }
    if (args.allowedPlaylists !== undefined) {
      if (args.allowedPlaylists.length === 0) {
        throw new Error('A survey needs at least one playlist');
      }
      patch.allowedPlaylists = args.allowedPlaylists;
    }

    if (args.questions !== undefined) {
      const firstSubmission = await ctx.db
        .query('submissions')
        .withIndex('by_survey', (q) => q.eq('surveyId', args.surveyId))
        .first();

      const kept = new Set(args.questions.map((q) => q.id));
      const dropped = survey.questions.filter((q) => !kept.has(q.id) && !q.archived);

      // Once anyone has answered, a removed question is ARCHIVED rather than
      // deleted. Hard-deleting it would orphan real student work: the answers
      // stay keyed by that id with nothing left to render them under.
      const preserved = firstSubmission
        ? dropped.map((q) => ({ ...q, archived: true, required: false }))
        : [];

      // Already-archived questions are always carried forward.
      const previouslyArchived = survey.questions.filter((q) => q.archived && !kept.has(q.id));

      patch.questions = [...args.questions, ...preserved, ...previouslyArchived];
    }

    await ctx.db.patch(args.surveyId, patch);
    return { archivedQuestions: (patch.questions as unknown[] | undefined)?.length ?? 0 };
  },
});

export const linkPlaylists = mutation({
  args: {
    surveyId: v.id('surveys'),
    allowedPlaylists: v.array(playlistTargetValidator),
    provider: v.union(v.literal('spotify'), v.literal('youtube'), v.null()),
  },
  handler: async (ctx, { surveyId, allowedPlaylists, provider }) => {
    const survey = await requireOwnedSurvey(ctx, surveyId);
    // A providerPlaylistId is only valid for the account that issued it. On a
    // provider switch every id must be cleared or it will 404 — or worse,
    // resolve to an unrelated playlist on the new account.
    const cleared =
      survey.provider !== provider
        ? allowedPlaylists.map((p) => ({ ...p, providerPlaylistId: null }))
        : allowedPlaylists;
    await ctx.db.patch(surveyId, { allowedPlaylists: cleared, provider });
  },
});

/**
 * Delete a survey and everything under it.
 *
 * Cascades on purpose: leaving orphaned submissions and songs behind would keep
 * student PII in the database with nothing left pointing at it, invisible to
 * the teacher and impossible to review or purge.
 */
export const remove = mutation({
  args: { surveyId: v.id('surveys') },
  handler: async (ctx, { surveyId }) => {
    await requireOwnedSurvey(ctx, surveyId);

    const songs = await ctx.db
      .query('songs')
      .withIndex('by_survey', (q) => q.eq('surveyId', surveyId))
      .collect();
    for (const song of songs) await ctx.db.delete(song._id);

    const submissions = await ctx.db
      .query('submissions')
      .withIndex('by_survey', (q) => q.eq('surveyId', surveyId))
      .collect();
    for (const s of submissions) await ctx.db.delete(s._id);

    await ctx.db.delete(surveyId);
    return { deletedSubmissions: submissions.length, deletedSongs: songs.length };
  },
});
