import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@cleaning-go/local-client';
import { bodyIsTooLarge, clientIp, hasJsonContentType, isRateLimited, isSameOriginRequest, readJsonBody, readRequestBytes, sessionCookieOptions } from '../../../../lib/request-security';

const api = () => process.env.LOCAL_API_URL || 'http://127.0.0.1:54321';
const actions = new Set(['query', 'rpc', 'signIn', 'signOut', 'getUser', 'getSession', 'recover', 'verifyRecovery', 'updateUser', 'signedUrls']);
const anonymousActions = new Set(['signIn', 'recover', 'verifyRecovery', 'getUser', 'getSession', 'signOut']);
const fail = (message: string, status: number) => NextResponse.json({ data: null, error: { message, status } }, { status });

export async function POST(request: NextRequest, { params }: { params: Promise<{ endpoint: string }> }) {
  if (!isSameOriginRequest(request)) return fail('Origin is not allowed', 403);
  const { endpoint } = await params;
  if (!['api', 'upload'].includes(endpoint)) return fail('Not found', 404);
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let payload: string | Uint8Array;
  let action = '';
  if (endpoint === 'api') {
    if (!hasJsonContentType(request)) return fail('JSON content type required', 415);
    const body = await readJsonBody<Record<string, unknown>>(request, 65536);
    if (!body || typeof body.action !== 'string' || !actions.has(body.action)) return fail('Invalid request', 400);
    action = body.action;
    if (!token && !anonymousActions.has(action)) return fail('Sign in required', 401);
    if (['signIn', 'recover', 'verifyRecovery'].includes(action) && isRateLimited(`proxy-auth:${clientIp(request)}:${action}:${action === 'signIn' && typeof body.email === 'string' ? body.email.toLowerCase().slice(0,254) : ''}`, action === 'recover' ? 5 : 30, 900000)) return fail('Too many attempts. Try again later.', 429);
    headers.set('Content-Type', 'application/json');
    payload = JSON.stringify(body);
  } else {
    if (!token) return fail('Sign in required', 401);
    if (bodyIsTooLarge(request, 16 * 1024 * 1024)) return fail('File too large', 413);
    const bytes = await readRequestBytes(request, 16 * 1024 * 1024);
    if (!bytes) return fail('File too large', 413);
    payload = bytes;
    for (const key of ['content-type', 'x-bucket', 'x-path', 'x-upsert']) {
      const value = request.headers.get(key);
      if (value) headers.set(key, value);
    }
  }
  try {
    const upstream = await fetch(`${api()}/${endpoint}`, { method: 'POST', headers, body: payload as BodyInit, signal: AbortSignal.timeout(15000), cache: 'no-store' });
    const result = await upstream.json();
    const session = result.data?.session;
    const nextToken = session?.access_token;
    // The browser receives user/session state, never the bearer credential.
    if (session) { delete session.access_token; delete session.refresh_token; }
    if (action === 'signedUrls' && Array.isArray(result.data)) {
      result.data = result.data.map((item: { signedUrl?: string }) => {
        if (!item.signedUrl) return item;
        const signed = new URL(item.signedUrl, api());
        return { ...item, signedUrl: `/api/local/file${signed.search}` };
      });
    }
    const response = NextResponse.json(result, { status: upstream.status, headers: { 'Cache-Control': 'no-store' } });
    if (nextToken) response.cookies.set(SESSION_COOKIE, nextToken, sessionCookieOptions(request.nextUrl.protocol === 'https:'));
    if (action === 'signOut') response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(request.nextUrl.protocol === 'https:'), maxAge: 0 });
    return response;
  } catch { return fail('Сервер временно недоступен', 503); }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ endpoint: string }> }) {
  if ((await params).endpoint !== 'file') return fail('Not found', 404);
  // Signed file links remain capabilities, validated again by the storage API.
  const query = new URLSearchParams();
  for (const key of ['bucket', 'path', 'expires', 'signature']) query.set(key, request.nextUrl.searchParams.get(key) || '');
  try {
    const upstream = await fetch(`${api()}/file?${query}`, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
    const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'none'" });
    for (const name of ['content-type', 'content-disposition']) { const value = upstream.headers.get(name); if (value) headers.set(name, value); }
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch { return fail('File unavailable', 503); }
}
