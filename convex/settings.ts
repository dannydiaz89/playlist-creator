import { v } from 'convex/values';
import { query, mutation, type MutationCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { requireTeacher } from './lib/auth';
import { playlistTargetValidator } from './schema';

/** TIER 1 — teacher. Returns this teacher's settings, creating nothing. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const teacherId = await requireTeacher(ctx);
    const row = await ctx.db
      .query('teacherSettings')
      .withIndex('by_teacher', (q) => q.eq('teacherId', teacherId))
      .unique();
    return row ?? { teacherId, provider: null, playlists: [] };
  },
});

async function upsert(
  ctx: MutationCtx,
  teacherId: string,
  patch: Partial<Omit<Doc<'teacherSettings'>, '_id' | '_creationTime'>>,
) {
  const existing = await ctx.db
    .query('teacherSettings')
    .withIndex('by_teacher', (q) => q.eq('teacherId', teacherId))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }
  return await ctx.db.insert('teacherSettings', {
    teacherId,
    provider: null,
    playlists: [],
    ...patch,
  });
}

/**
 * Switching provider CLEARS the playlist pool: a providerPlaylistId is only
 * valid for the account that issued it, and a stale one either 404s or resolves
 * to an unrelated playlist on the new account.
 */
export const setProvider = mutation({
  args: { provider: v.union(v.literal('spotify'), v.literal('youtube'), v.null()) },
  handler: async (ctx, { provider }) => {
    const teacherId = await requireTeacher(ctx);
    const existing = await ctx.db
      .query('teacherSettings')
      .withIndex('by_teacher', (q) => q.eq('teacherId', teacherId))
      .unique();
    const changed = existing?.provider !== provider;
    await upsert(ctx, teacherId, {
      provider,
      ...(changed ? { playlists: [] } : {}),
    });
    return { cleared: changed && (existing?.playlists.length ?? 0) > 0 };
  },
});

export const setPlaylists = mutation({
  args: { playlists: v.array(playlistTargetValidator) },
  handler: async (ctx, { playlists }) => {
    const teacherId = await requireTeacher(ctx);
    const seen = new Set<string>();
    for (const p of playlists) {
      const label = p.label.trim();
      if (!label) throw new Error('Every playlist needs a name students will see');
      if (seen.has(label)) throw new Error(`Duplicate playlist name: ${label}`);
      seen.add(label);
    }
    await upsert(ctx, teacherId, { playlists });
  },
});

/**
 * Which providers actually have credentials on THIS deployment.
 *
 * Provider secrets live in the Convex environment (Better Auth runs inside
 * Convex), so only a Convex function can see them. Without this the UI happily
 * redirects to Spotify with an undefined client_id and the teacher gets a bare
 * "client_id: Invalid" page with no clue what to fix.
 *
 * Returns booleans only — never the values.
 */
export const providerStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireTeacher(ctx);
    return {
      spotify: Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET),
      youtube: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      // The redirect URI to register with each provider, derived from the
      // deployment's own config so it cannot drift from what is actually sent.
      callbackBase: `${process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000'}/api/auth/callback`,
    };
  },
});
