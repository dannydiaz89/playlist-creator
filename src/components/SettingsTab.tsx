'use client';
import { useQuery, useMutation, useConvexAuth } from 'convex/react';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@convex/_generated/api';
import { authClient } from '@/lib/auth-client';
import { useAnnounce } from '@/components/LiveRegion';
import { BlockSkeleton } from '@/components/Skeleton';
import { btn, panel, badge, cn } from '@/lib/design';
import type { ProviderName } from '@/lib/providers';

const META: Record<ProviderName, { label: string; note: string }> = {
  youtube: {
    label: 'YouTube Music',
    note: 'Matches tracks by title, so check the playlist after syncing. Capped at ~10,000 API units/day.',
  },
  spotify: { label: 'Spotify', note: 'Matches tracks exactly by ISRC or track id.' },
};

/** Account and provider connection only. Playlists live in their own tab. */
export function SettingsTab({ onGoToPlaylists }: { onGoToPlaylists: () => void }) {
  const announce = useAnnounce();
  const { isAuthenticated } = useConvexAuth();
  const args = isAuthenticated ? {} : 'skip';
  const settings = useQuery(api.settings.get, args);
  const status = useQuery(api.settings.providerStatus, args);
  const setProvider = useMutation(api.settings.setProvider);

  const [linked, setLinked] = useState<Set<string> | null>(null);

  const provider = (settings?.provider ?? null) as ProviderName | null;
  const providerId = provider === 'youtube' ? 'google' : 'spotify';
  const isLinked = linked?.has(providerId) ?? false;

  const refreshLinked = useCallback(async () => {
    try {
      const { data } = await authClient.listAccounts();
      setLinked(new Set((data ?? []).map((a: { providerId: string }) => a.providerId)));
    } catch { setLinked(new Set()); }
  }, []);
  useEffect(() => { refreshLinked(); }, [refreshLinked]);

  async function choose(p: ProviderName) {
    const { cleared } = await setProvider({ provider: p });
    announce(
      cleared
        ? `Switched to ${META[p].label}. Previously offered playlists were cleared — they only work on the old account.`
        : `Switched to ${META[p].label}.`,
    );
  }

  if (settings === undefined || linked === null) {
    return (
      <section className={cn(panel, 'p-6')}>
        <BlockSkeleton lines={3} label="Loading provider settings" />
      </section>
    );
  }

  return (
    <section className={cn(panel, 'p-6')} aria-labelledby="providerH">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 id="providerH" className="text-lg font-medium">Music provider</h2>
          <p className="text-sm text-muted mt-1 max-w-xl">
            The account approved tracks are synced into. Choose which playlists students
            can pick in the <button type="button" onClick={onGoToPlaylists}
              className="text-accent underline underline-offset-2">Playlists tab</button>.
          </p>
        </div>
        <span className={isLinked ? badge.clean : badge.pending}>
          {isLinked && provider ? `${META[provider].label} connected` : 'Not connected'}
        </span>
      </div>

      <div className="mt-5 pt-5 border-t border-rule">
        <div role="group" aria-label="Choose provider" className="flex flex-wrap gap-2 mb-4">
          {(['youtube', 'spotify'] as ProviderName[]).map((p) => (
            <button key={p} type="button" onClick={() => choose(p)} aria-pressed={provider === p}
              className={provider === p ? btn.primary : btn.secondary}>
              {META[p].label}
            </button>
          ))}
        </div>

        {provider && <p className="text-sm text-muted mb-4">{META[provider].note}</p>}
        {!provider && <p className="text-sm text-muted">Pick a provider to get started.</p>}

        {provider && status && !status[provider] && (
          <div className="border border-amber-200 bg-amber-50 rounded-lg p-4" role="alert">
            <p className="text-sm text-warn font-medium">
              {META[provider].label} isn&apos;t configured on this deployment yet
            </p>
            <p className="text-sm text-muted mt-1">
              Its credentials live in the <strong className="text-ink">Convex</strong> environment,
              not <code className="font-mono text-xs">.env.local</code> — Better Auth runs inside
              Convex and never reads that file.
            </p>
            <pre className="mt-3 p-3 bg-white border border-rule rounded-lg text-xs font-mono overflow-x-auto">
{provider === 'spotify'
  ? `npx convex env set SPOTIFY_CLIENT_ID '...'\nnpx convex env set SPOTIFY_CLIENT_SECRET '...'`
  : `npx convex env set GOOGLE_CLIENT_ID '...'\nnpx convex env set GOOGLE_CLIENT_SECRET '...'`}
            </pre>
            <p className="text-sm text-muted mt-3">Register this redirect URI with the provider:</p>
            <code className="block mt-1 text-xs font-mono break-all text-ink">
              {status.callbackBase}/{provider === 'spotify' ? 'spotify' : 'google'}
            </code>
            <p className="text-sm text-muted mt-3">
              Then restart <code className="font-mono text-xs">pnpm dev:convex</code> — the
              deployment reads these at startup.
            </p>
          </div>
        )}

        {provider && status?.[provider] && isLinked && (
          <button type="button" className={btn.secondary}
            onClick={async () => {
              await authClient.unlinkAccount({ providerId });
              await refreshLinked();
              announce(`${META[provider].label} disconnected.`);
            }}>
            Disconnect {META[provider].label}
          </button>
        )}

        {provider && status?.[provider] && !isLinked && (
          <button type="button" className={btn.primary}
            onClick={() => authClient.linkSocial({
              // linkSocial, NOT signIn.social: this attaches the provider to the
              // CURRENT teacher account. signIn.social treats it as a fresh
              // sign-in, fails with account_not_linked when the emails match,
              // and drops the teacher's session on the way out.
              provider: providerId as 'spotify' | 'google',
              callbackURL: '/teacher?tab=settings',
              scopes: provider === 'youtube'
                ? ['https://www.googleapis.com/auth/youtube']
                : ['playlist-modify-public', 'playlist-modify-private', 'playlist-read-private'],
            })}>
            Connect {META[provider].label}
          </button>
        )}
      </div>
    </section>
  );
}
