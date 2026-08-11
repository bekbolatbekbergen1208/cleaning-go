import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type CookieToSet = { name: string; value: string; options: CookieOptions };
const publicPaths = new Set(['/', '/register', '/login', '/api/register']);

export async function middleware(request: NextRequest) {
  if (publicPaths.has(request.nextUrl.pathname)) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => request.cookies.getAll(), setAll(items: CookieToSet[]) { items.forEach(({ name, value }) => request.cookies.set(name, value)); response = NextResponse.next({ request }); items.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); } } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
