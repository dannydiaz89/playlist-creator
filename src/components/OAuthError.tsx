'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { AlertTriangle, X } from 'lucide-react';
import { btn, panel, cn } from '@/lib/design';

/**
 * Providers report failures by redirecting back with `?error=<code>`. Without
 * this the app just renders its normal page and the only clue is the URL bar.
 */
const MESSAGES: Record<string, { title: string; body: string }> = {
  state_mismatch: {
    title: 'The connection attempt expired',
    body:
      'This usually means an older attempt was still open, or the provider page sat idle for more than five minutes. Close any leftover provider tabs and try Connect again.',
  },
  please_restart_the_process: {
    title: 'The connection could not be completed',
    body:
      'The security cookie from the start of the sign-in was missing at the end. Make sure you start and finish on the same address, then try Connect again.',
  },
  invalid_code: {
    title: 'The provider rejected the sign-in',
    body: 'The authorization code was not accepted. Try Connect again.',
  },
  account_not_linked: {
    title: 'That provider account could not be linked',
    body:
      'The provider signed in as a different identity than your teacher account, so it was not attached. Sign in again, then use Connect from the Settings tab — that links the provider to the account you are already signed into.',
  },
  access_denied: {
    title: 'Access was declined',
    body: 'You (or the provider) declined the permission request. Connect again and accept to continue.',
  },
};

export function OAuthError() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const e = params.get('error');
    if (e) setError(e);
  }, [params]);

  if (!error) return null;
  const known = MESSAGES[error];

  function dismiss() {
    const next = new URLSearchParams(params.toString());
    next.delete('error');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    setError(null);
  }

  return (
    <div className={cn(panel, 'border-amber-200 bg-amber-50 p-4 mb-6')} role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-warn shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink">
            {known?.title ?? 'The connection did not complete'}
          </p>
          <p className="text-sm text-muted mt-1">
            {known?.body ?? 'The provider reported a problem. Try connecting again.'}
          </p>
          <p className="text-sm text-muted mt-2 font-mono text-xs">{error}</p>
        </div>
        <button type="button" onClick={dismiss} aria-label="Dismiss"
          className={cn(btn.ghost, '!min-h-0 !p-2 -m-1 shrink-0')}>
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
