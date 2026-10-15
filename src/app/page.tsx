'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Music, Lock, ArrowRight } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Dialog } from '@/components/Dialog';
import { OAuthError } from '@/components/OAuthError';
import { btn, input, panel, layout, cn } from '@/lib/design';

/** Better Auth's raw codes are opaque to a teacher; translate the ones that
 *  actually happen into something actionable. */
function friendlyAuthError(error: { code?: string; message?: string }): string {
  switch (error.code) {
    case 'INVALID_ORIGIN':
      return `This page's address isn't trusted by the server. Open the app at ${
        process.env.NEXT_PUBLIC_APP_URL ?? 'http://127.0.0.1:3000'
      } instead.`;
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'Email or password is incorrect.';
    case 'MISSING_OR_NULL_ORIGIN':
      return 'Your browser did not send an origin header. Try a normal browser window.';
    default:
      return error.message ?? 'Sign in failed.';
  }
}

function HomeInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [signInOpen, setSignInOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [busy, setBusy] = useState(false);

  // middleware redirects here with ?signin=1 when /teacher is hit unauthenticated
  useEffect(() => { if (params.get('signin')) setSignInOpen(true); }, [params]);

  function joinClass(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) { setCodeError('Enter the code your teacher gave you.'); return; }
    setCodeError('');
    router.push(`/survey?code=${encodeURIComponent(c)}`);
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setAuthError('');
    const { error } = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (error) { setAuthError(friendlyAuthError(error)); return; }
    router.push('/teacher');
  }

  return (
    <>
      <header className="bg-white border-b border-rule">
        <div className={cn(layout.wide, 'h-16 flex items-center justify-between')}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent text-white grid place-items-center">
              <Music className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <div className="font-semibold leading-tight">Playlist Creator</div>
              <div className="text-sm text-muted leading-tight">Classroom music curation</div>
            </div>
          </div>
          <button type="button" onClick={() => setSignInOpen(true)} className={btn.secondary}>
            <Lock className="w-5 h-5 text-muted" aria-hidden="true" />
            Teacher sign in
          </button>
        </div>
      </header>

      <main id="main" className={cn(layout.reading, 'flex-1 py-12 sm:py-20')}>
        <OAuthError />
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold">Join your class playlist</h1>
          <p className="text-base text-muted mt-2 max-w-md mx-auto">
            Enter the code your teacher shared to suggest music for your class.
          </p>
        </div>

        <div className={cn(panel, 'p-6 sm:p-8')}>
          <form onSubmit={joinClass} noValidate>
            <label htmlFor="joinCode" className="block text-sm font-medium mb-1.5">
              Class join code <span className="text-bad" aria-hidden="true">*</span>
              <span className="sr-only">(required)</span>
            </label>
            <input
              id="joinCode"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={cn(input.base, 'font-mono text-lg font-semibold uppercase tracking-wide')}
              placeholder="P4-BEATS"
              maxLength={12}
              autoComplete="off"
              aria-describedby="joinHelp"
              aria-invalid={codeError ? true : undefined}
            />
            <p id="joinHelp" className="text-sm text-muted mt-1.5">
              Check the whiteboard for your period&apos;s code.
            </p>
            {codeError && (
              <p role="alert" className="text-sm text-bad font-medium mt-1.5">{codeError}</p>
            )}
            <button type="submit" className={cn(btn.primary, 'w-full mt-5')}>
              Enter classroom survey
              <ArrowRight className="w-5 h-5" aria-hidden="true" />
            </button>
          </form>
        </div>

        <p className="text-sm text-muted mt-6 text-center max-w-md mx-auto">
          Your suggestions are reviewed by your teacher before anything is added to a playlist.
        </p>
      </main>

      <footer className="border-t border-rule bg-white py-5">
        <p className={cn(layout.wide, 'text-sm text-muted text-center')}>
          Classroom Playlist Creator
        </p>
      </footer>

      <Dialog open={signInOpen} onClose={() => setSignInOpen(false)} title="Teacher sign in">
        <form onSubmit={signIn} noValidate className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1.5">Email</label>
            <input id="email" type="email" data-autofocus value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={input.base} autoComplete="username" required />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1.5">Password</label>
            <input id="password" type="password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={input.base} autoComplete="current-password" required />
          </div>
          {authError && <p role="alert" className="text-sm text-bad font-medium">{authError}</p>}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={() => setSignInOpen(false)} className={btn.secondary}>
              Cancel
            </button>
            <button type="submit" disabled={busy} className={btn.primary}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>
        <p className="text-sm text-muted mt-5 pt-5 border-t border-rule">
          Sign-up is not public. Teacher accounts are seeded with{' '}
          <code className="font-mono text-xs">pnpm seed</code>.
        </p>
      </Dialog>
    </>
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}
