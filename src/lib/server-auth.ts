import type { ProviderName } from '@/lib/providers';

/**
 * Provider access tokens for the route handlers.
 *
 * Better Auth refreshes these, so the teacher stays connected across sessions
 * rather than re-authenticating every hour.
 *
 * Convex identity is handled separately by `@/lib/convex-server`, which uses
 * the JWT rather than the opaque session cookie.
 */

/**
 * Exchange the session for a provider access token via Better Auth.
 * Throws if the account was never linked or the refresh token was revoked.
 */
export async function getProviderAccessToken(
  provider: ProviderName,
  cookieHeader: string,
): Promise<string> {
  const providerId = provider === 'youtube' ? 'google' : 'spotify';
  const base = process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000';

  const res = await fetch(`${base}/api/auth/get-access-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: cookieHeader,
      // Better Auth rejects originless POSTs as CSRF (MISSING_OR_NULL_ORIGIN).
      // A browser sets this; a server-side fetch must send it explicitly, and
      // it has to match a trusted origin or the call fails with a 403 that
      // looks exactly like "not connected".
      Origin: base,
    },
    body: JSON.stringify({ providerId }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Distinguish "never linked" from "linked but the call failed" — reporting
    // the second as the first sends the teacher round a loop reconnecting an
    // account that is already connected.
    if (res.status === 400 || /not.*linked|no.*account/i.test(body)) {
      throw new Error(
        provider === 'youtube'
          ? 'Connect your Google account before syncing to YouTube Music.'
          : 'Connect Spotify before syncing.',
      );
    }
    throw new Error(
      `Could not get a ${provider === 'youtube' ? 'YouTube' : 'Spotify'} access token ` +
      `(${res.status}). ${body.slice(0, 160)}`,
    );
  }

  const data = await res.json();
  const token = data.accessToken ?? data.access_token;
  if (!token) throw new Error('Provider returned no access token — reconnect the account.');
  return token;
}
