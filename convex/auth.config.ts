import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config';
import type { AuthConfig } from 'convex/server';

/**
 * Tells Convex how to validate the JWT Better Auth issues.
 *
 * WITHOUT this file, `ctx.auth.getUserIdentity()` returns null in every Convex
 * function and each one throws "Not authenticated" — even though the browser
 * has a perfectly valid session cookie.
 */
export default {
  providers: [getAuthConfigProvider()],
} satisfies AuthConfig;
