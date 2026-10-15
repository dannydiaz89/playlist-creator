import { convexBetterAuthNextJs } from '@convex-dev/better-auth/nextjs';

/** Handles sign-in, sign-out, and the Spotify / Google OAuth redirect+callback. */
const { handler } = convexBetterAuthNextJs({
  convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL!,
  convexSiteUrl: process.env.NEXT_PUBLIC_CONVEX_SITE_URL!,
});

export const { GET, POST } = handler;
