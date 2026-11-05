import { createServer } from 'node:http';
import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
  createHmac,
} from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase } from './database.mjs';
import { queryDatabase, callFunction } from './query.mjs';
const hash = (text) => createHash('sha256').update(text).digest('hex');
export const passwordHash = (password) => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
};
const passwordMatches = (password, stored) => {
  const [salt, key] = stored.split(':');
  return (
    !!key &&
    timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(key, 'hex'))
  );
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
  await mkdir(root, { recursive: true });
  const db = database || (await openDatabase(resolve(root, 'db')));
  const limits = new Map();
  function rate(key, max = 20) {
    const now = Date.now();
    const v = limits.get(key);
    if (!v || v.until < now) {
      limits.set(key, { count: 1, until: now + 900000 });
      return;
    }
    if (++v.count > max)
      throw Object.assign(
        new Error('Слишком много запросов. Попробуйте позже.'),
        { status: 429 },
      );
  }
  const userShape = (u) => ({
    id: u.id,
    email: u.email,
    phone: u.phone,
    user_metadata: u.raw_user_meta_data,
  });
  async function session(user) {
    const token = randomBytes(32).toString('hex');
    const expires = Date.now() + 7 * 86400000;
    await db.query('insert into auth.sessions values($1,$2,$3)', [
      hash(token),
      user.id,
      new Date(expires).toISOString(),
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
      `select u.* from auth.sessions s join auth.users u on u.id=s.user_id join public.profiles p on p.id=u.id where s.token_hash=$1 and s.expires_at>now() and p.status='active'`,
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
  const server = createServer(async (req, res) => {
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
          !sig ||
          sig.length !== expected.length ||
          !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ||
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
          'Content-Disposition': 'inline',
        });
        res.end(file);
        return;
      }
      if (req.method !== 'POST') {
        send({ error: { message: 'Not found' } }, 404);
        return;
      }
      const who = await identity(req);
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16 * 1024 * 1024)
          throw Object.assign(new Error('Request too large'), { status: 413 });
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      if (url.pathname === '/upload') {
        if (!who.user)
          throw Object.assign(new Error('Sign in required'), { status: 401 });
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
        await writeFile(file, raw);
        send({ data: { path }, error: null });
        return;
      }
      if (url.pathname !== '/api') {
        send({ error: { message: 'Not found' } }, 404);
        return;
      }
      const body = JSON.parse(raw.toString() || '{}');
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
        rate(`login:${req.socket.remoteAddress}`);
        const email = String(body.email || '')
          .trim()
          .toLowerCase();
        const password = String(body.password || '');
        if (password.length > 256) throw new Error('Invalid credentials');
        const u = (
          await db.query(
            "select u.* from auth.users u join public.profiles p on p.id=u.id where lower(u.email)=$1 and p.status='active'",
            [email],
          )
        ).rows[0];
        if (!u || !passwordMatches(password, u.encrypted_password))
          throw Object.assign(new Error('Неверный email или пароль'), {
            status: 401,
          });
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
              passwordHash(u.password),
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
        await db.transaction(async (tx) => {
          await tx.query(
            'update auth.users set encrypted_password=$1 where id=$2',
            [passwordHash(body.password), who.user.id],
          );
          await tx.query('delete from auth.sessions where user_id=$1', [
            who.user.id,
          ]);
        });
        const s = await session(who.user);
        send({ data: { user: s.user, session: s }, error: null });
        return;
      }
      if (body.action === 'recover') {
        rate(`recovery:${req.socket.remoteAddress}`, 5);
        const u = (
          await db.query(
            'select id,email from auth.users where lower(email)=$1',
            [String(body.email).toLowerCase()],
          )
        ).rows[0];
        if (u) {
          const token = randomBytes(32).toString('hex');
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
        rate(`verify:${req.socket.remoteAddress}`);
        const u = await db.transaction(async (tx) => {
          const r = (
            await tx.query(
              'delete from auth.recoveries where token_hash=$1 and expires_at>now() returning user_id',
              [hash(String(body.token_hash))],
            )
          ).rows[0];
          return r
            ? (
                await tx.query('select * from auth.users where id=$1', [
                  r.user_id,
                ])
              ).rows[0]
            : null;
        });
        if (!u) throw new Error('Invalid or expired recovery link');
        const s = await session(u);
        send({ data: { user: s.user, session: s }, error: null });
        return;
      }
      if (body.action === 'signedUrls') {
        if (!who.admin && !who.user)
          throw Object.assign(new Error('Forbidden'), { status: 403 });
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
      send(
        {
          data: null,
          error: {
            message: error.message,
            code: error.code,
            status: error.status || 400,
          },
        },
        error.status || 400,
      );
    }
  });
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
  const app = await startServer();
  console.log(`Local API: http://127.0.0.1:${app.port}`);
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
}
