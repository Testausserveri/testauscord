import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  const cookie = request.cookies.get('__Host-session');

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

  if (request.nextUrl.pathname.startsWith('/channels/@me')) {
    const url = request.nextUrl.clone();
    url.pathname = `/channels/me${url.pathname.split('/channels/@me')[1]}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}
