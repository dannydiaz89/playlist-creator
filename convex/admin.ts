import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { components } from './_generated/api';

/**
 * Delete a teacher account by email, via the Better Auth component's adapter.
 *
 * `internalMutation` — NOT callable from the browser, only from the CLI:
 *   npx convex run admin:deleteTeacher '{"email":"someone@example.com"}'
 *
 * Useful for clearing test accounts, which can otherwise sign in with a known
 * password.
 */
export const deleteTeacher = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'user',
      where: [{ field: 'email', operator: 'eq', value: email }],
    });
    if (!user) return { deleted: false, reason: 'no such account' };

    // Sessions and accounts reference the user; remove them first.
    for (const model of ['session', 'account'] as const) {
      await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: {
          model,
          where: [{ field: 'userId', operator: 'eq', value: (user as { _id: string })._id }],
        },
        paginationOpts: { cursor: null, numItems: 200 },
      } as never);
    }
    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: { model: 'user', where: [{ field: 'email', operator: 'eq', value: email }] },
    } as never);
    return { deleted: true, email };
  },
});
