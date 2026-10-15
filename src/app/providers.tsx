'use client';
import { ConvexReactClient } from 'convex/react';
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import type { AuthClient } from '@convex-dev/better-auth/react';
import { authClient } from '@/lib/auth-client';

/**
 * No `expectAuth: true`.
 *
 * That option makes the client hold every query until authentication resolves.
 * Students are anonymous by design (the survey is Tier 2), so for them auth
 * never arrives and the page loads forever.
 *
 * Teacher-side queries instead pass 'skip' until `useConvexAuth()` reports
 * authenticated, so they never fire before the token exists.
 */
const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConvexBetterAuthProvider client={convex} authClient={authClient as unknown as AuthClient}>
      {children}
    </ConvexBetterAuthProvider>
  );
}
