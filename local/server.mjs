import { createServer } from 'node:http';
import {
  randomBytes,
  createHash,
  scrypt,
  timingSafeEqual,
  createHmac,
} from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createLimiter, httpError, readBody, validFileBytes } from './security.mjs';
import { openDatabase } from './database.mjs';
import { queryDatabase, callFunction } from './query.mjs';
const hash = (text) => createHash('sha256').update(text).digest('hex');
const deriveKey = promisify(scrypt);
export const passwordHash = async (password) => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await deriveKey(password, salt, 64)).toString('hex')}`;
};
const passwordMatches = async (password, stored) => {
  const [salt, key] = String(stored).split(':');
  if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(key)) return false;
  return timingSafeEqual(await deriveKey(password, salt, 64), Buffer.from(key, 'hex'));
};
export async function startServer({
  port = Number(process.env.LOCAL_API_PORT || 54321),
  dataDir = process.env.LOCAL_DATA_ROOT || './.local-data',
  database,
  serviceKey = process.env.LOCAL_SERVICE_KEY,
} = {}) {
  if (!serviceKey || serviceKey.length < 32)
    throw new Error(
      'Run node local/setup.mjs first: LOCAL_SERVICE_KEY is required',
    );
  const root = resolve(dataDir);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const db = database || (await openDatabase(resolve(root, 'db')));
  const limits = new Map();
  const limiter = createLimiter();
  const dummyPassword = await passwordHash(randomBytes(32).toString("hex"));
  let activePasswordJobs = 0;
  async function passwordJob(fn) {
    if (activePasswordJobs >= 4) throw httpError("Authentication busy. Try again.", 429);
    activePasswordJobs++;
    try { return await fn(); } finally { activePasswordJobs--; }
  }
  const tooMany = () =>
    Object.assign(new Error('Слишком много запросов. Попробуйте позже.'), {
      status: 429,
    });
  function hit(key) {
    const now = Date.now();
    if (limits.size >= 10000)
      for (const [k, v] of limits) if (v.until <= now) limits.delete(k);
    const v = limits.get(key);
    if (!v || v.until < now) {
      if (!v && limits.size >= 10000) throw tooMany();
      limits.set(key, { count: 1, until: now + 900000 });
      return 1;
    }
    return ++v.count;
  }
  function rate(key, max = 20) {
    if (hit(key) > max) throw tooMany();
  }
  // Web logins all arrive from the Next.js server address, so a per-IP counter
  // of every attempt would lock out the whole site after a few logins. Count
  // only failed attempts per address and account; a success clears them.
  const LOGIN_FAILURES = 10;
  function loginBlocked(key) {
    const v = limits.get(key);
    return !!v && v.until >= Date.now() && v.count >= LOGIN_FAILURES;
  }
  const userShape = (u) => ({
    id: u.id,
    email: u.email,
    phone: u.phone,
    user_metadata: u.raw_user_meta_data,
  });
  async function session(user, recovery = false) {
    const token = randomBytes(32).toString('hex');
    const expires = Date.now() + (recovery ? 15 * 60000 : 7 * 86400000);
    await db.query('delete from auth.sessions where expires_at<=now()');
    await db.query('insert into auth.sessions(token_hash,user_id,expires_at,is_recovery) values($1,$2,$3,$4)', [
      hash(token),
      user.id,
      new Date(expires).toISOString(),
      recovery,
    ]);
    return {
      access_token: token,
      refresh_token: token,
      token_type: 'bearer',
      expires_at: Math.floor(expires / 1000),
      user: userShape(user),
    };
  }
  async function identity(req) {
    if (req.headers['x-service-key'] === serviceKey)
      return { admin: true, user: null };
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!token) return { admin: false, user: null };
    const { rows } = await db.query(
      `select u.*,s.is_recovery from auth.sessions s join auth.users u on u.id=s.user_id join public.profiles p on p.id=u.id where s.token_hash=$1 and s.expires_at>now() and p.status='active'`,
      [hash(token)],
    );
    return { admin: false, user: rows[0] || null };
  }
  async function scoped(who, fn) {
    return db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
        who.user?.id || '',
      ]);
      await tx.exec(
        `set local role ${who.admin ? 'service_role' : who.user ? 'authenticated' : 'anon'}`,
      );
      return fn(tx);
    });
  }
  const server = createServer({ maxHeaderSize: 16384, requestTimeout: 30000, headersTimeout: 10000, keepAliveTimeout: 5000 }, async (req, res) => {
    const origin = req.headers.origin;
    const allowed = (
      process.env.LOCAL_ALLOWED_ORIGINS ||
      'http://localhost:3000,http://127.0.0.1:3000,http://localhost:8081,http://127.0.0.1:8081'
    ).split(',');
    if (origin && !allowed.includes(origin)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type,Authorization,X-Service-Key,X-Bucket,X-Path,X-Upsert',
    );
    res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const send = (value, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    try {
      // Every web user reaches the API through the co-located Next.js server, so a
      // loopback address carries the whole site's traffic (each open tab polls
      // ~20 times a minute). Keep the strict cap for direct remote clients only.
      if (limiter.hit(`request:${req.socket.remoteAddress}`, isLoopback(req.socket.remoteAddress) ? 30000 : 1200, 60000)) throw tooMany();
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health' && req.method === 'GET') {
        send({ ok: true, database: 'local-postgresql' });
        return;
      }
      if (url.pathname === '/file' && req.method === 'GET') {
        const bucket = url.searchParams.get('bucket'),
          path = url.searchParams.get('path'),
          expires = url.searchParams.get('expires'),
          sig = url.searchParams.get('signature');
        const expected = createHmac('sha256', serviceKey)
          .update(`${bucket}:${path}:${expires}`)
          .digest('hex');
        if (
          !/^[a-f0-9]{64}$/.test(sig || '') ||
          sig.length !== expected.length ||
          !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ||
          !/^\d{13}$/.test(expires || "") ||
          !Number.isSafeInteger(Number(expires)) ||
          Number(expires) < Date.now()
        )
          throw Object.assign(new Error('Expired file link'), { status: 403 });
        validatePath(bucket, path);
        const file = await readFile(resolve(root, 'files', bucket, path));
        const object = (
          await db.query(
            'select metadata from storage.objects where bucket_id=$1 and name=$2',
            [bucket, path],
          )
        ).rows[0];
        res.writeHead(200, {
          'Content-Type':
            object?.metadata?.mimetype || 'application/octet-stream',
          'Content-Disposition': object?.metadata?.mimetype === 'application/pdf' ? 'attachment' : 'inline',
          'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'none'",
        });
        res.end(file);
        return;
      }
      if (req.method !== 'POST') {
        send({ error: { message: 'Not found' } }, 404);
        return;
      }
      const who = await identity(req);
      if (url.pathname === '/upload' && who.user?.is_recovery) throw httpError('Complete password recovery first', 403);
      if (url.pathname === '/upload' && !who.user) throw httpError('Sign in required', 401);
      const raw = await readBody(req, url.pathname === '/upload' ? 16 * 1024 * 1024 : 65536);
      const size = raw.length;
      if (url.pathname === '/upload') {
        if (!who.user)
          throw Object.assign(new Error('Sign in required'), { status: 401 });
        if (limiter.hit(`upload:${who.user.id}`, 30, 60000)) throw tooMany();
        const bucket = req.headers['x-bucket'],
          path = req.headers['x-path'];
        validatePath(bucket, path);
        if (path.split('/')[0] !== who.user.id)
          throw Object.assign(new Error('File access denied'), { status: 403 });
        const config = (
          await db.query('select * from storage.buckets where id=$1', [bucket])
        ).rows[0];
        const type = String(
          req.headers['content-type'] || 'application/octet-stream',
        );
        if (
          !config ||
          size > Number(config.file_size_limit) ||
          !validFileBytes(type, raw) ||
          (config.allowed_mime_types &&
            !config.allowed_mime_types.includes(type))
        )
          throw new Error('Invalid file type or size');
        const file = resolve(root, 'files', bucket, path);
        await mkdir(dirname(file), { recursive: true });
        await scoped(who, (tx) =>
          tx.query(
            `insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3) ${req.headers['x-upsert'] === 'true' ? 'on conflict(bucket_id,name) do update set metadata=excluded.metadata' : ''}`,
            [bucket, path, { mimetype: type, size }],
          ),
        );
        await writeFile(file, raw, { mode: 0o600 });
        send({ data: { path }, error: null });
        return;
      }
      if (url.pathname !== '/api') {
        send({ error: { message: 'Not found' } }, 404);
        return;
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw httpError('JSON content type required', 415);
      let body;
      try { body = JSON.parse(raw.toString()); } catch { throw httpError('Invalid JSON'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.action !== 'string') throw httpError('Invalid request');
      if (who.user?.is_recovery && !['getUser', 'getSession', 'updateUser', 'signOut'].includes(body.action)) throw httpError('Complete password recovery first', 403);
      if (body.action === 'query') {
        send(await scoped(who, (tx) => queryDatabase(tx, body.plan)));
        return;
      }
      if (body.action === 'rpc') {
        if (!who.user && !who.admin)
          throw Object.assign(new Error('Sign in required'), { status: 401 });
        send(await scoped(who, (tx) => callFunction(tx, body.name, body.args)));
        return;
      }
      if (body.action === 'signIn') {
        const email = String(body.email || '')
          .trim()
          .toLowerCase();
        const loginKey = `login:${req.socket.remoteAddress}:${email}`;
        if (loginBlocked(loginKey)) throw tooMany();
        if (typeof body.email !== 'string' || email.length > 254 || typeof body.password !== 'string' || !body.password || body.password.length > 256) throw httpError('Invalid credentials', 401);
        const password = body.password;
        if (limiter.hit(`password:${req.socket.remoteAddress}`, 100, 60000)) throw tooMany();
        const u = (
          await db.query(
            "select u.* from auth.users u join public.profiles p on p.id=u.id where lower(u.email)=$1 and p.status='active'",
            [email],
          )
        ).rows[0];
        const matches = await passwordJob(() => passwordMatches(password, u?.encrypted_password || dummyPassword));
        if (!u || !matches) {
          hit(loginKey);
          throw Object.assign(new Error('Неверный email или пароль'), {
            status: 401,
          });
        }
        limits.delete(loginKey);
        const s = await session(u);
        send({ data: { user: s.user, session: s }, error: null });
        return;
      }
      if (body.action === 'getUser' || body.action === 'getSession') {
        send({
          data: {
            user: who.user ? userShape(who.user) : null,
            session: who.user
              ? {
                  access_token: (req.headers.authorization || '').replace(
                    /^Bearer /,
                    '',
                  ),
                  user: userShape(who.user),
                }
              : null,
          },
          error: null,
        });
        return;
      }
      if (body.action === 'signOut') {
        await db.query('delete from auth.sessions where token_hash=$1', [
          hash((req.headers.authorization || '').replace(/^Bearer /, '')),
        ]);
        send({ error: null });
        return;
      }
      if (body.action === 'createUser') {
        if (!who.admin)
          throw Object.assign(new Error('Forbidden'), { status: 403 });
        const u = body.user;
        if (
          !u || typeof u.email !== 'string' || u.email.length > 254 ||
          !/^\S+@\S+\.\S+$/.test(u.email) ||
          typeof u.password !== 'string' ||
          u.password.length < 8 ||
          u.password.length > 256
        )
          throw new Error('Invalid email/password');
        const user = (
          await db.query(
            'insert into auth.users(email,phone,encrypted_password,raw_user_meta_data) values($1,$2,$3,$4) returning *',
            [
              u.email.toLowerCase(),
              u.phone || null,
              await passwordJob(() => passwordHash(u.password)),
              u.user_metadata || {},
            ],
          )
        ).rows[0];
        send({ data: { user: userShape(user) }, error: null });
        return;
      }
      if (body.action === 'updateUser') {
        if (
          !who.user ||
          typeof body.password !== 'string' ||
          body.password.length < 8 ||
          body.password.length > 256
        )
          throw new Error('Sign in and use at least 8 characters');
        rate(`password-update:${who.user.id}`, 10);
        if (!who.user.is_recovery && (typeof body.currentPassword !== 'string' || body.currentPassword.length > 256 || !await passwordJob(() => passwordMatches(body.currentPassword, who.user.encrypted_password)))) throw httpError('Current password required', 403);
        await db.transaction(async (tx) => {
          await tx.query(
            'update auth.users set encrypted_password=$1 where id=$2',
            [await passwordJob(() => passwordHash(body.password)), who.user.id],
          );
          await tx.query('delete from auth.sessions where user_id=$1', [
            who.user.id,
          ]);
        });
        await db.query('delete from auth.recoveries where user_id=$1', [who.user.id]);
        const s = await session(who.user);
        send({ data: { user: s.user, session: s }, error: null });
        return;
      }
      if (body.action === 'recover') {
        if (typeof body.email !== 'string' || body.email.length > 254) throw httpError('Invalid email');
        // Per account, plus a generous per-address cap: web requests all share
        // the Next.js server address, so a per-address limit of 5 blocked
        // password recovery for the whole site.
        // The address cap runs first so random e-mails cannot flood the counters.
        rate(`recovery-all:${req.socket.remoteAddress}`, isLoopback(req.socket.remoteAddress) ? 300 : 20);
        rate(`recovery:${req.socket.remoteAddress}:${body.email.trim().toLowerCase()}`, 5);
        const u = (
          await db.query(
            'select id,email from auth.users where lower(email)=$1',
            [String(body.email).toLowerCase()],
          )
        ).rows[0];
        if (u) {
          const token = randomBytes(32).toString('hex');
          await db.query('delete from auth.recoveries where user_id=$1', [u.id]);
          await db.query('insert into auth.recoveries values($1,$2,$3)', [
            hash(token),
            u.id,
            new Date(Date.now() + 3600000).toISOString(),
          ]);
          await mkdir(resolve(root, 'mail'), { recursive: true });
          await writeFile(
            resolve(
              root,
              'mail',
              `${Date.now()}-${randomBytes(4).toString('hex')}.json`,
            ),
            JSON.stringify(
              {
                to: u.email,
                link: `${body.redirectTo === 'cleaninggo://reset-password' ? body.redirectTo : `${process.env.PUBLIC_APP_URL || 'http://localhost:3000'}/reset-password`}?token_hash=${token}`,
              },
              null,
              2,
            ),
            { mode: 0o600 },
          );
        }
        send({ data: {}, error: null });
        return;
      }
      if (body.action === 'verifyRecovery') {
        if (typeof body.token_hash !== 'string' || !/^[a-f0-9]{64}$/.test(body.token_hash)) throw httpError('Invalid or expired recovery link');
        // Recovery tokens are 256-bit random values, so guessing is infeasible;
        // the cap only bounds load and must not block every web user at once.
        rate(`verify:${req.socket.remoteAddress}`, isLoopback(req.socket.remoteAddress) ? 300 : 20);
        const u = await db.transaction(async (tx) => {
          const r = (
            await tx.query(
              'delete from auth.recoveries where token_hash=$1 and expires_at>now() returning user_id',
              [hash(String(body.token_hash))],
            )
          ).rows[0];
          return r
            ? (
                await tx.query("select u.* from auth.users u join profiles p on p.id=u.id where u.id=$1 and p.status='active'", [
                  r.user_id,
                ])
              ).rows[0]
            : null;
        });
        if (!u) throw new Error('Invalid or expired recovery link');
        const s = await session(u, true);
        send({ data: { user: s.user, session: s }, error: null });
        return;
      }
      if (body.action === 'signedUrls') {
        if (!who.admin && !who.user)
          throw Object.assign(new Error('Forbidden'), { status: 403 });
        if (!Array.isArray(body.paths) || body.paths.length > 50 || !Number.isFinite(body.expires) || body.expires <= 0) throw httpError('Invalid file link request');
        const data = [];
        for (const path of body.paths) {
          validatePath(body.bucket, path);
          const visible = await scoped(who, (tx) =>
            tx.query(
              'select id from storage.objects where bucket_id=$1 and name=$2',
              [body.bucket, path],
            ),
          );
          if (!visible.rows.length) {
            data.push({ path, error: 'Forbidden', signedUrl: null });
            continue;
          }
          const expires =
            Date.now() + Math.min(Number(body.expires) || 3600, 86400) * 1000;
          const signature = createHmac('sha256', serviceKey)
            .update(`${body.bucket}:${path}:${expires}`)
            .digest('hex');
          data.push({
            path,
            signedUrl: `${process.env.LOCAL_PUBLIC_API_URL || ''}/file?${new URLSearchParams({ bucket: body.bucket, path, expires: String(expires), signature })}`,
          });
        }
        send({ data, error: null });
        return;
      }
      throw new Error('Unknown action');
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      const safeMessage = ['23505', '23503', '23502', '23514', '22P02', '42703', '42P01', '42501'].includes(error.code)
        ? (error.code === '23505' ? 'Record already exists' : error.code === '42501' ? 'Access denied' : 'Invalid request data')
        : error.code && error.code !== 'P0001' ? 'Request failed' : error.message;
      send(
        {
          data: null,
          error: {
            message: safeMessage,
            code: error.code,
            status: error.status || 400,
          },
        },
        error.status || 400,
      );
    }
  });
  server.maxRequestsPerSocket = 1000;
  server.setTimeout(30000);
  try {
    await new Promise((ok, fail) => {
      server.once('error', fail);
      server.listen(port, process.env.LOCAL_API_HOST || '127.0.0.1', ok);
    });
  } catch (error) {
    await db.close();
    throw error;
  }
  return {
    server,
    db,
    port: server.address().port,
    close: async () => {
      await new Promise((ok) => server.close(ok));
      await db.close();
    },
  };
}
// The co-located Next.js server (and only processes on this machine) connect
// from a loopback address; phones on the LAN keep their own addresses.
export function isLoopback(address = '') {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
function validatePath(bucket, path) {
  if (
    typeof bucket !== 'string' ||
    !/^[a-z0-9-]+$/.test(bucket) ||
    typeof path !== 'string' ||
    !/^[a-zA-Z0-9_./-]+$/.test(path) ||
    path.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw new Error('Invalid file path');
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  let app;
  try {
    app = await startServer();
  } catch (error) {
    if (error instanceof WebAssembly.RuntimeError) {
      console.error(
        'The local database could not be opened; it was probably left open by a crash or a closed terminal.\n' +
          'Recovery: keep a copy of .local-data/db, copy the folder to a new one, delete postmaster.pid in the copy\n' +
          'and use the copy as .local-data/db. Keep .local-data outside folders synced by OneDrive/Dropbox.',
      );
    }
    throw error;
  }
  console.log(`Local API: http://127.0.0.1:${app.port}`);
  let stopping = false;
  // SIGHUP: the terminal window was closed (Windows gives ~10 s); SIGBREAK:
  // Ctrl+Break on Windows. Without these the database was never closed cleanly.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'])
    process.on(signal, async () => {
      if (stopping) return;
      stopping = true;
      await app.close();
      process.exit(0);
    });
}
