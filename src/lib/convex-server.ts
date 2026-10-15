import { convexBetterAuthNextJs } from '@convex-dev/better-auth/nextjs';

/**
 * Single Better Auth <-> Convex bridge for server-side route handlers.
 *
 * `getToken()` returns the **JWT** Convex verifies. Passing Better Auth's raw
 * session cookie to `client.setAuth()` instead produces:
 *   InvalidAuthHeader — Could not parse JWT payload
 * because the session cookie is an opaque token, not a three-part JWT.
 */
export const {
  getToken,
  isAuthenticated,
  fetchAuthQuery,
  fetchAuthMutation,
} = convexBetterAuthNextJs({
  convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL!,
  convexSiteUrl: process.env.NEXT_PUBLIC_CONVEX_SITE_URL!,
});
