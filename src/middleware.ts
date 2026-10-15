import { NextResponse, type NextRequest } from 'next/server';

/**
 * Defence in depth ONLY — this is not the security boundary.
 *
 * It guards Next.js page navigations. The real boundary is the per-function
 * check inside every Convex function, because the Convex URL is public and
 * callable directly from a browser console. Never let the presence of this
 * file justify skipping those checks.
 *
 * Deliberately minimal: an earlier version also canonicalised localhost ->
 * 127.0.0.1 to keep OAuth on one origin, but it produced an app-wide redirect
 * loop and did not address the failure it was meant to prevent. Host
 * consistency is documented in the README instead.
 */
export function middleware(req: NextRequest) {
  const hasSession =
    req.cookies.has('better-auth.session_token') ||
    req.cookies.has('__Secure-better-auth.session_token');

  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.searchParams.set('signin', '1');
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/teacher/:path*'] };
