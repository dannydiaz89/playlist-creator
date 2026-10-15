import { betterAuth } from 'better-auth';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { convex as convexPlugin } from '@convex-dev/better-auth/plugins';
import authConfig from './auth.config';
import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { components } from './_generated/api';
import type { DataModel } from './_generated/dataModel';

/**
 * Better Auth owns teacher identity AND both provider connections.
 *
 * The "zero-credential server" idea was dropped deliberately: it was already
 * violated by the sync route, and it made screening impossible. Provider
 * refresh tokens are persisted here so the teacher stays connected across
 * sessions instead of re-authenticating every hour.
 */
export const authComponent = createClient<DataModel>(components.betterAuth);

const baseURL = process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000';

/**
 * `localhost` and `127.0.0.1` are the SAME machine but DIFFERENT origins, and
 * Better Auth's CSRF check compares origins literally. baseURL must stay on
 * 127.0.0.1 because Spotify refuses `localhost` as a redirect URI — so in local
 * dev we trust both spellings, otherwise signing in from localhost:3000 fails
 * with "Invalid origin".
 *
 * Local only: in production the origin is whatever baseURL says, nothing more.
 */
const isLocalDev = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseURL);
const port = new URL(baseURL).port || '3000';
const trustedOrigins = isLocalDev
  ? [`http://localhost:${port}`, `http://127.0.0.1:${port}`]
  : [baseURL];

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    database: authComponent.adapter(ctx),
    baseURL,
    trustedOrigins,
    secret: process.env.BETTER_AUTH_SECRET,

    emailAndPassword: {
      // Sign-up stays reachable but is gated on a secret only the operator has
      // (see the hook below). An UNGATED sign-up on a public URL would let
      // anyone create an account and read student PII.
      //
      // This replaces `disableSignUp: true`, which made seeding the first
      // account require editing this file and remembering to change it back.
      enabled: true,
    },

    // Issues the Convex-verifiable JWT. Pairs with convex/auth.config.ts —
    // both are required, and neither works alone.
    plugins: [convexPlugin({ authConfig })],

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return;

        const expected = process.env.TEACHER_INVITE_CODE;
        // Fail CLOSED: with no invite code configured, nobody can sign up.
        // A missing env var must never mean "open to everyone".
        if (!expected) {
          throw new APIError('FORBIDDEN', {
            message: 'Sign-up is closed. Set TEACHER_INVITE_CODE to enable it.',
          });
        }
        const provided = (ctx.body as { inviteCode?: unknown } | undefined)?.inviteCode;
        if (typeof provided !== 'string' || provided !== expected) {
          throw new APIError('FORBIDDEN', { message: 'A valid invite code is required.' });
        }
      }),
    },

    account: {
      accountLinking: { enabled: true, trustedProviders: ['spotify', 'google'] },
    },

    socialProviders: {
      spotify: {
        clientId: process.env.SPOTIFY_CLIENT_ID as string,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET as string,
        scope: ['playlist-modify-public', 'playlist-modify-private', 'playlist-read-private'],
      },
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID as string,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
        scope: ['https://www.googleapis.com/auth/youtube'],
        accessType: 'offline',
        prompt: 'consent', // required to actually receive a refresh token
      },
    },
  });
