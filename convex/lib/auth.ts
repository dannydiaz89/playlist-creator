import type { QueryCtx, MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';

/**
 * THE security boundary.
 *
 * The Convex deployment URL is public, so any student can call these functions
 * directly from devtools. A check in a Next.js route handler, in middleware, or
 * in a React component protects nothing. Authorization lives here.
 */

type Ctx = QueryCtx | MutationCtx;

export async function requireTeacher(ctx: Ctx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw new Error('Not authenticated');
  return identity.subject;
}

/**
 * Authentication is not authorization. Without the ownership check any signed-in
 * teacher could moderate any other teacher's class.
 *
 * Throws the SAME error for "missing" and "not yours" so the existence of
 * another teacher's survey is never leaked.
 */
export async function requireOwnedSurvey(
  ctx: Ctx,
  surveyId: Id<'surveys'>,
): Promise<Doc<'surveys'>> {
  const teacherId = await requireTeacher(ctx);
  const survey = await ctx.db.get(surveyId);
  if (!survey || survey.teacherId !== teacherId) throw new Error('Survey not found');
  return survey;
}

export async function requireOwnedSong(ctx: Ctx, songId: Id<'songs'>) {
  const song = await ctx.db.get(songId);
  if (!song) throw new Error('Song not found');
  await requireOwnedSurvey(ctx, song.surveyId); // throws unless caller owns the parent
  return song;
}
