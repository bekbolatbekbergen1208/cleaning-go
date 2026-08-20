import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { email?: string; password?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password;

  if (!email || !password) {
    return NextResponse.json({ error: 'Введите email и пароль' }, { status: 400 });
  }

  const cookiesToSet: CookieToSet[] = [];
  const staleAuthCookieNames = request.cookies
    .getAll()
    .map(({ name }) => name)
    .filter((name) => name.startsWith('sb-') && name.includes('-auth-token'));
  const applyAuthCookies = (response: NextResponse) => {
    // A previous, larger session can leave an extra chunk such as `.2` in the
    // browser. Supabase then joins the new `.0`/`.1` cookies with that stale
    // chunk and rejects the otherwise valid session. Remove every old chunk
    // first; the fresh cookies below replace the chunks used by the new token.
    staleAuthCookieNames.forEach((name) => response.cookies.set(name, '', { path: '/', maxAge: 0 }));
    cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    return response;
  };
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items: CookieToSet[]) => cookiesToSet.push(...items),
      },
    },
  );

  // Clear an expired session before creating the new one. This also removes
  // stale chunked refresh-token cookies left by a previous account.
  await supabase.auth.signOut({ scope: 'local' });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return applyAuthCookies(NextResponse.json({ error: 'Неверный email или пароль' }, { status: 401 }));
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();

  if (!profile?.role) {
    await supabase.auth.signOut({ scope: 'local' });
    return applyAuthCookies(NextResponse.json(
      { error: 'Профиль аккаунта не найден. Обратитесь в поддержку.' },
      { status: 403 },
    ));
  }

  const destination = profile.role === 'admin'
    ? '/admin'
    : profile.role === 'company_owner'
      ? '/company'
      : '/profile';
  return applyAuthCookies(NextResponse.json({ destination }));
}
