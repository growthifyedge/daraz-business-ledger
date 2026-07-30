import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/auth';
import {
  verifyPresentationToken,
  isPresentationBlockedPage,
  PRESENTATION_COOKIE,
} from '@/lib/presentation/core';

// Routes that do not require authentication.
const PUBLIC_PATHS = ['/login', '/api/auth/login'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );

  const token = req.cookies.get(COOKIE_NAME)?.value;
  const user = await verifySession(token);

  // Not signed in → send to login (except public routes).
  if (!user && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Signed in but visiting /login → send to dashboard.
  if (user && pathname === '/login') {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Owner-only area guard (defence in depth; pages also check).
  if (user && pathname.startsWith('/audit-log') && user.role !== 'OWNER') {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  // Presentation Safe View: block the raw-data owner pages while active. This is
  // a UX redirect only — the pages, route handlers and actions enforce the block
  // independently, so security never relies on this middleware check alone.
  if (user && isPresentationBlockedPage(pathname)) {
    const psv = await verifyPresentationToken(req.cookies.get(PRESENTATION_COOKIE)?.value);
    if (psv.active) {
      const url = req.nextUrl.clone();
      url.pathname = '/dashboard';
      url.search = '';
      url.searchParams.set('psv', 'blocked');
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on everything except Next internals and static assets.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
