import { createHash } from 'node:crypto';

export const httpError = (message, status = 400) => Object.assign(new Error(message), { status });
export function createLimiter(maxKeys = 10000) {
  const buckets = new Map();
  let nextSweep = 0;
  return {
    hit(key, max, windowMs) {
      const now = Date.now();
      if (now >= nextSweep || buckets.size >= maxKeys) {
        for (const [k, v] of buckets) if (v.until <= now) buckets.delete(k);
        nextSweep = now + 60000;
      }
      const digest = createHash('sha256').update(key).digest('hex');
      let entry = buckets.get(digest);
      if (!entry) {
        // Fail closed rather than grow memory indefinitely under random-key attacks.
        if (buckets.size >= maxKeys) return true;
        entry = { count: 0, until: now + windowMs };
        buckets.set(digest, entry);
      }
      entry.count += 1;
      return entry.count > max;
    },
  };
}

export async function readBody(req, maxBytes) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw httpError('Request too large', 413);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw httpError('Request too large', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function validFileBytes(type, bytes) {
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (type === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/webp') return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (type === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  return false;
}
