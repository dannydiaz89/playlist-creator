'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { btn, panel, layout, cn } from '@/lib/design';

/**
 * Without this, a thrown Convex query (an expired session, a transient auth
 * hiccup) replaces the whole page with Next's bare
 * "Application error: a client-side exception has occurred".
 */
export default function Error({
  error, reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => { console.error(error); }, [error]);

  const isAuth = /not authenticated|unauthorized/i.test(error.message);

  return (
    <main id="main" className={cn(layout.reading, 'flex-1 py-12')}>
      <div className={cn(panel, 'p-6')}>
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warn shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-medium">
              {isAuth ? 'Your session has expired' : 'Something went wrong'}
            </h1>
            <p className="text-sm text-muted mt-2">
              {isAuth
                ? 'Sign in again to continue.'
                : 'The page hit an unexpected error. Trying again often clears it.'}
            </p>
            <p className="text-sm text-muted mt-3 font-mono text-xs break-all">{error.message}</p>
            <div className="flex flex-wrap gap-2 mt-5">
              <button type="button" onClick={reset} className={btn.primary}>Try again</button>
              <Link href="/" className={btn.secondary}>Back to start</Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
