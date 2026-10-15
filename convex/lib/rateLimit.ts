import type { MutationCtx } from '../_generated/server';

/**
 * Students are unauthenticated by design, so this is the only thing standing
 * between the app and one bored student inserting thousands of rows.
 */
export async function enforceRateLimit(
  ctx: MutationCtx,
  key: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const now = Date.now();
  const existing = await ctx.db
    .query('rateLimits')
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique();

  if (!existing) {
    await ctx.db.insert('rateLimits', { key, count: 1, windowStart: now });
    return;
  }
  if (now - existing.windowStart > windowMs) {
    await ctx.db.patch(existing._id, { count: 1, windowStart: now });
    return;
  }
  if (existing.count >= limit) {
    throw new Error('Too many submissions. Please wait a few minutes and try again.');
  }
  await ctx.db.patch(existing._id, { count: existing.count + 1 });
}
