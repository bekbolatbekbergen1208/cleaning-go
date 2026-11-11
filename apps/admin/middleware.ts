import { createServerClient, type CookieOptions } from '@cleaning-go/local-client';
import { sessionCookieOptions } from './lib/request-security';
import { NextResponse, type NextRequest } from 'next/server';

type CookieToSet = { name: string; value: string; options: CookieOptions };
const publicPaths = new Set(['/', '/register', '/login', '/admin/login', '/api/register', '/api/auth/login', '/reset-password']);
const adminPaths = ['/admin', '/orders', '/verifications', '/users', '/services', '/moderation', '/settings'];

function secure(response: NextResponse) {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-DNS-Prefetch-Control', 'off');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self), payment=(), usb=(), browsing-topics=()');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return response;
}

export async function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = [
    "default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https://tile.openstreetmap.org",
    "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');
  const headers = new Headers(request.headers);
  headers.set('Content-Security-Policy', csp);
  headers.set('x-nonce', nonce);
  const response = await handleRequest(request, headers);
  response.headers.set('Content-Security-Policy', request.nextUrl.pathname === '/api/local/file' ? "sandbox; default-src 'none'; frame-ancestors 'none'" : csp);
  return secure(response);
}

async function handleRequest(request: NextRequest, headers: Headers) {
  // Authentication endpoints manage their own session cookies.
  if (['/api/auth/login', '/api/register'].includes(request.nextUrl.pathname) || request.nextUrl.pathname.startsWith('/api/local/')) return NextResponse.next({ request: { headers } });

  let response = NextResponse.next({ request: { headers } });
  const backend = createServerClient(
    (process.env.LOCAL_API_URL || 'http://127.0.0.1:54321'),
    '',
    { cookies: { getAll: () => request.cookies.getAll(), setAll(items: CookieToSet[]) { items.forEach(({ name, value }) => request.cookies.set(name, value)); response = NextResponse.next({ request: { headers } }); items.forEach(({ name, value, options }) => response.cookies.set(name, value, { ...options, ...sessionCookieOptions(request.nextUrl.protocol === 'https:'), maxAge: options.maxAge })); } } },
  );
  const { data: { user } } = await backend.auth.getUser();
  if (!user && request.nextUrl.pathname.startsWith('/api/orders/')) {
    const unauthorized = NextResponse.json({ error: 'Сначала войдите в аккаунт' }, { status: 401 });
    response.cookies.getAll().forEach(cookie => unauthorized.cookies.set(cookie));
    return secure(unauthorized);
  }
  if (!user && !publicPaths.has(request.nextUrl.pathname) && !request.nextUrl.pathname.startsWith('/r/')) {
    const isAdminPath = adminPaths.some((path) => request.nextUrl.pathname === path || request.nextUrl.pathname.startsWith(`${path}/`));
    const redirectResponse = NextResponse.redirect(new URL(isAdminPath ? '/admin/login' : '/login', request.url));
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return secure(redirectResponse);
  }
  return secure(response);
}

// The web manifest and icons must stay public: browsers fetch the manifest
// without cookies, and "Add to Home Screen" on iPhone/Android happens before login.
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon|apple-icon|.*\\.(?:png|svg|ico|webp|jpg|jpeg)$).*)'] };
