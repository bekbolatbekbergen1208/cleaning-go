import type { NextRequest } from 'next/server';

type Attempt = { count: number; resetAt: number };
const buckets = new Map<string, Attempt>();

export function clientIp(request: NextRequest) {
  // Forwarding headers are attacker-controlled unless a trusted reverse proxy
  // overwrites them. Local mode deliberately uses a shared conservative bucket.
  return process.env.TRUST_PROXY_HEADERS === 'true'
    ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) || 'unknown'
    : 'local';
}

export function isRateLimited(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  if (buckets.size >= 10_000) {
    for (const [bucketKey, value] of buckets) if (value.resetAt <= now) buckets.delete(bucketKey);
  }
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    if (!current && buckets.size >= 10_000) return true;
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

export function sessionCookieOptions(secure = false) {
  return { path: '/', sameSite: 'lax' as const, httpOnly: true,
    secure: secure || process.env.PUBLIC_APP_URL?.startsWith('https:') === true,
    maxAge: 604800 };
}

export async function readRequestBytes(request: NextRequest, maxBytes = 32_768): Promise<Uint8Array | null> {
  if (bodyIsTooLarge(request, maxBytes)) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } catch { return null; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function hasJsonContentType(request: NextRequest) {
  return /^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '');
}

export function bodyIsTooLarge(request: NextRequest, maxBytes = 32_768) {
  const length = Number(request.headers.get('content-length') ?? 0);
  return Number.isFinite(length) && length > maxBytes;
}

export async function readJsonBody<T>(request: NextRequest, maxBytes = 32_768): Promise<T | null> {
  const bytes = await readRequestBytes(request, maxBytes);
  if (!bytes) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as T : null;
  } catch { return null; }
}

export function isSameOriginRequest(request: NextRequest) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const allowed = new Set([request.nextUrl.origin, process.env.PUBLIC_APP_URL].filter(Boolean));
  return allowed.has(origin);
}
