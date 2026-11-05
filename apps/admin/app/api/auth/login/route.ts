import { createServerClient, type CookieOptions } from '@cleaning-go/local-client';
import { NextResponse, type NextRequest } from 'next/server';
import { bodyIsTooLarge, clientIp, hasJsonContentType, isRateLimited, isSameOriginRequest, readJsonBody } from '../../../../lib/request-security';

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Origin is not allowed' }, { status: 403 });
  }
  if (!hasJsonContentType(request) || bodyIsTooLarge(request)) {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }
  if (isRateLimited(`login:${clientIp(request)}`, 10, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'Слишком много попыток входа. Попробуйте через 15 минут.' }, { status: 429 });
  }
  const body = await readJsonBody<{ email?: string; password?: string }>(request);
  const email = body?.email?.trim().toLowerCase().slice(0, 254);
  const password = body?.password;

  if (!email || !password || password.length > 256) {
    return NextResponse.json({ error: 'Введите email и пароль' }, { status: 400 });
  }

  const cookiesToSet: CookieToSet[] = [];
  const staleAuthCookieNames = request.cookies
    .getAll()
    .map(({ name }) => name)
    .filter((name) => name === 'cleaning-go-session' || (name.startsWith('sb-') && name.includes('-auth-token')));
  const applyAuthCookies = (response: NextResponse) => {
    // Remove cookies left by previous sessions before applying the new token.
    staleAuthCookieNames.forEach((name) => response.cookies.set(name, '', { path: '/', maxAge: 0 }));
    cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    return response;
  };
  const backend = createServerClient(
    (process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://127.0.0.1:54321'),
    '',
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items: CookieToSet[]) => cookiesToSet.push(...items),
      },
    },
  );

  // Clear an expired session before creating the new one. This also removes
  // stale chunked refresh-token cookies left by a previous account.
  await backend.auth.signOut({ scope: 'local' });
  const { data, error } = await backend.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return applyAuthCookies(NextResponse.json({ error: 'Неверный email или пароль' }, { status: 401 }));
  }

  const { data: profile } = await backend
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();

  if (!profile?.role) {
    await backend.auth.signOut({ scope: 'local' });
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
  if (profile.role === 'client') {
    const { data: client, error: clientError } = await backend.from('client_profiles').select('preferred_company_id').eq('user_id', data.user.id).maybeSingle();
    if (clientError) return applyAuthCookies(NextResponse.json({ error: 'Не удалось загрузить компанию. Попробуйте ещё раз.' }, { status: 503 }));
    if (!client?.preferred_company_id) return applyAuthCookies(NextResponse.json({ destination: '/profile/company' }));
  }
  return applyAuthCookies(NextResponse.json({ destination }));
}
