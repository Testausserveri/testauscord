import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const cookie = request.cookies.get('session');

  if (
    !request.nextUrl.pathname.startsWith('/login') &&
    !request.nextUrl.pathname.startsWith('/signup') &&
    request.nextUrl.pathname !== '/' &&
    !request.nextUrl.pathname.startsWith('/_next') &&
    !cookie
  ) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if ((request.nextUrl.pathname.startsWith('/login') || request.nextUrl.pathname.startsWith('/signup')) && cookie) return NextResponse.redirect(new URL('/channels/@me', request.url));

  return NextResponse.next();
}
