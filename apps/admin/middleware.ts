import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type CookieToSet = { name: string; value: string; options: CookieOptions };
const publicPaths = new Set(['/', '/register', '/login', '/admin/login', '/api/register', '/api/auth/login', '/reset-password']);
const adminPaths = ['/admin', '/orders', '/verifications', '/users', '/services', '/moderation', '/settings'];

function secure(response: NextResponse) {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-DNS-Prefetch-Control', 'off');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self), payment=(), usb=(), browsing-topics=()');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return response;
}

export async function middleware(request: NextRequest) {
  // Authentication endpoints manage their own session cookies.
  if (['/api/auth/login', '/api/register'].includes(request.nextUrl.pathname)) return secure(NextResponse.next());

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    { cookies: { getAll: () => request.cookies.getAll(), setAll(items: CookieToSet[]) { items.forEach(({ name, value }) => request.cookies.set(name, value)); response = NextResponse.next({ request }); items.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); } } },
  );
  const { data: { user } } = await supabase.auth.getUser();
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

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
