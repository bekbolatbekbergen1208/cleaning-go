import type { NextRequest } from 'next/server';

type Attempt = { count: number; resetAt: number };
const buckets = new Map<string, Attempt>();

export function clientIp(request: NextRequest) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || 'unknown';
}

export function isRateLimited(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  current.count += 1;
  if (buckets.size > 10_000) {
    for (const [bucketKey, value] of buckets) if (value.resetAt <= now) buckets.delete(bucketKey);
  }
  return current.count > limit;
}

export function hasJsonContentType(request: NextRequest) {
  return request.headers.get('content-type')?.toLowerCase().startsWith('application/json') ?? false;
}

export function bodyIsTooLarge(request: NextRequest, maxBytes = 32_768) {
  const length = Number(request.headers.get('content-length') ?? 0);
  return Number.isFinite(length) && length > maxBytes;
}

export function isSameOriginRequest(request: NextRequest) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const allowed = new Set([request.nextUrl.origin, process.env.PUBLIC_APP_URL].filter(Boolean));
  return allowed.has(origin);
}
