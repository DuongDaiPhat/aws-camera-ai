import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from './lib/auth-session';

export function getAuthRedirect(pathname: string, hasSession: boolean): string | null {
  if (!hasSession && pathname !== '/login') return '/login';
  if (hasSession && pathname === '/login') return '/';
  return null;
}

export function middleware(request: NextRequest): NextResponse {
  const redirectPath = getAuthRedirect(
    request.nextUrl.pathname,
    request.cookies.get(SESSION_COOKIE)?.value === 'active',
  );
  if (!redirectPath) return NextResponse.next();

  return NextResponse.redirect(new URL(redirectPath, request.url));
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
