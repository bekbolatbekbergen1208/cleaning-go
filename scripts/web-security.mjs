// Run after building Next.js: node scripts/web-security.mjs
// Uses a separate temporary database and a temporary web port, never live users.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startServer } from '../local/server.mjs';
import { createClient } from '../packages/local-client/src/index.js';
const require = createRequire(new URL('../apps/admin/package.json', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'cleaning-web-security-'));
const key = 'web-security-test-service-key-'.repeat(3);
const app = await startServer({ port: 0, dataDir: dir, serviceKey: key });
const admin = createClient(`http://127.0.0.1:${app.port}`, key);
const base = 'http://127.0.0.1:3107';
const password = 'web-test-password-123';
let checks = 0, child;
const ok = r => { assert.equal(r.error, null, JSON.stringify(r)); return r.data; };
const check = (actual, expected, label) => { assert.equal(actual, expected, label); checks++; };
const post = (path, body, cookie = '', extra = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, cookie, ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body), redirect: 'manual' });
try {
  const owner = ok(await admin.auth.admin.createUser({ email: 'owner@web.test', phone: '+77016660001', password, user_metadata: { role: 'company_owner', full_name: 'Компания тест', company_name: 'Web QA', company_registration_number: '123456789012', company_city: 'Актау', company_address: 'Дом 1', company_phone: '+77016660001' } })).user;
  const company = ok(await admin.from('company_profiles').select('*').eq('owner_id', owner.id).single());
  ok(await admin.from('company_profiles').update({ verification_status: 'approved' }).eq('id', company.id));
  const community = ok(await admin.from('cleaner_communities').insert({ name: 'Web QA community', code: 'COM-WEBQA', created_by: owner.id }).select('*').single());
  for (const [role, email, phone] of [['client', 'client@web.test', '+77016660002'], ['cleaner', 'cleaner@web.test', '+77016660003'], ['client', 'admin@web.test', '+77016660004']]) {
    const user = ok(await admin.auth.admin.createUser({ email, phone, password, user_metadata: { role, full_name: 'Web QA', ...(role === 'cleaner' ? { referral_code: community.code } : { referral_code: company.company_code }) } })).user;
    if (role === 'cleaner') ok(await admin.from('cleaner_profiles').update({ verification_status: 'approved', is_available: true, workday_ends_at: new Date(Date.now()+3600000).toISOString() }).eq('user_id', user.id));
    if (email === 'admin@web.test') ok(await admin.from('profiles').update({ role: 'admin' }).eq('id', user.id));
  }
  child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3107'], {
    cwd: fileURLToPath(new URL('../apps/admin/', import.meta.url)),
    env: { ...process.env, NODE_ENV: 'production', LOCAL_API_URL: `http://127.0.0.1:${app.port}`, LOCAL_SERVICE_KEY: key, PUBLIC_APP_URL: base, SEED_ADMIN_EMAIL: 'admin@web.test' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = ''; child.stdout.on('data', x => { logs += x; }); child.stderr.on('data', x => { logs += x; });
  for (let n = 0; n < 100; n++) {
    try { if ((await fetch(base + '/login')).ok) break; } catch {}
    if (child.exitCode !== null) throw new Error(logs);
    await new Promise(r => setTimeout(r, 100));
  }
  for (const path of ['/', '/login', '/register', '/admin/login', '/reset-password', '/manifest.webmanifest', '/icon-192.png', '/apple-icon.png']) {
    const r = await fetch(base + path); check(r.status, 200, `public ${path}`);
  }
  const loginPage = await fetch(base + '/login'); const html = await loginPage.text();
  const csp = loginPage.headers.get('content-security-policy');
  assert.ok(csp?.includes("object-src 'none'") && !csp.includes("script-src 'self' 'unsafe-inline'")); checks++;
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1]; assert.ok(nonce && html.includes(`nonce="${nonce}"`), 'CSP nonce matches Next.js scripts'); checks++;
  check(loginPage.headers.get('x-powered-by'), null, 'framework fingerprint removed');
  check(loginPage.headers.get('referrer-policy'), 'no-referrer', 'recovery URL cannot leak through Referer');
  for (const body of ['null', '[]', '{', { email: {}, password: {} }, { email: 'admin@web.test', password: [] }]) check((await post('/api/auth/login', body)).status, 400, 'malformed login');
  check((await post('/api/auth/login', { email: 'admin@web.test', password }, '', { origin: 'https://evil.example' })).status, 403, 'CSRF login');
  check((await post('/api/local/api', { action: 'getUser' }, '', { origin: 'https://evil.example' })).status, 403, 'CSRF proxy');
  check((await post('/api/local/api', { action: 'createUser', user: {} })).status, 400, 'proxy cannot create privileged users');
  check((await post('/api/local/api', { action: 'query', plan: { table: 'profiles' } })).status, 401, 'anonymous private query');
  for (const path of ['/admin', '/users', '/orders', '/company', '/profile', '/cleaner/my-work']) check((await fetch(base + path, { redirect: 'manual' })).status, 307, `anonymous ${path}`);
  let adminCookie = '';
  for (const [role, paths] of [
    ['admin', ['/admin', '/users', '/orders', '/companies', '/communities', '/services', '/settings', '/moderation', '/verifications', '/notifications']],
    ['owner', ['/company', '/company/orders', '/company/employees', '/company/sales', '/company/reports', '/company/cities', '/company/tracking', '/notifications']],
    ['client', ['/profile', '/profile/orders', '/profile/company', '/order/new', '/notifications']],
    ['cleaner', ['/profile', '/cleaner/direct-orders', '/cleaner/company-orders', '/cleaner/my-work', '/notifications']],
  ]) {
    const r = await post('/api/auth/login', { email: `${role}@web.test`, password }); check(r.status, 200, `${role} login`);
    const cookies = r.headers.getSetCookie(); const cookie = cookies.filter(x => x.startsWith('cleaning-go-session=')).at(-1);
    assert.ok(cookie?.includes('HttpOnly') && cookie.includes('SameSite=lax')); checks++;
    const auth = cookie.split(';')[0]; if (role === 'admin') adminCookie = auth;
    for (const path of paths) {
      const response = await fetch(base + path, { headers: { cookie: auth }, redirect: 'manual' }); const page = await response.text();
      check(response.status, 200, `${role} ${path}`); assert.ok(!page.includes('Internal Server Error') && !/"digest":"[0-9]+"/.test(page), `${role} ${path} rendered`); checks++;
    }
    const session = await post('/api/local/api', { action: 'getSession' }, auth); const data = await session.json();
    assert.ok(data.data.session?.user && !data.data.session.access_token && !data.data.session.refresh_token, 'proxy hides bearer token'); checks++;
    if (role === 'client') {
      const userId = data.data.session.user.id;
      const filePath = `${userId}/web-upload.png`;
      const upload = await fetch(base + '/api/local/upload', { method: 'POST', headers: { origin: base, cookie: auth, 'content-type': 'image/png', 'x-bucket': 'order-photos', 'x-path': filePath }, body: Buffer.from([137,80,78,71,13,10,26,10]) });
      check(upload.status, 200, 'proxy upload');
      const signed = await post('/api/local/api', { action: 'signedUrls', bucket: 'order-photos', paths: [filePath], expires: 60 }, auth).then(r => r.json());
      assert.ok(signed.data[0].signedUrl.startsWith('/api/local/file?')); checks++;
      const file = await fetch(base + signed.data[0].signedUrl);
      check(file.status, 200, 'signed private file proxy');
      assert.ok(file.headers.get('content-security-policy')?.includes('sandbox')); checks++;
      const address = await post('/api/local/api', { action: 'query', plan: { table: 'addresses', operation: 'insert', values: { user_id: userId, city: 'Актау', address_line: 'QA test address' }, returning: true, single: 'required' } }, auth).then(r => r.json());
      assert.equal(address.error, null); checks++;
      const order = await post('/api/local/api', { action: 'rpc', name: 'create_order', args: { payload: { service_id: '10000000-0000-0000-0000-000000000001', address_id: address.data.id, scheduled_at: new Date(Date.now()+86400000).toISOString(), area_sq_m: 50, rooms_count: 2, executor_preference: 'company', selected_company_id: company.id, payment_method: 'cash', photo_urls: [filePath], option_ids: [] } } }, auth).then(r => r.json());
      assert.equal(order.error, null, JSON.stringify(order)); checks++;
      const cancelled = await post('/api/local/api', { action: 'rpc', name: 'transition_order_status', args: { target_order_id: order.data.id, next_status: 'cancelled' } }, auth).then(r => r.json());
      check(cancelled.data?.status, 'cancelled', 'client order cancellation through proxy');
    }
    if (role !== 'admin') check((await fetch(base + '/admin', { headers: { cookie: auth }, redirect: 'manual' })).status, 307, `${role} denied admin`);
  }
  const proxyLogin = await post('/api/local/api', { action: 'signIn', email: 'admin@web.test', password });
  check(proxyLogin.status, 200, 'browser admin login through proxy'); const proxyData = await proxyLogin.json();
  assert.ok(proxyData.data.session.user && !proxyData.data.session.access_token); checks++;
  check((await post('/api/register', { email: 'evil@web.test', phone: '+77016660005', password, full_name: 'Evil', role: 'admin' })).status, 400, 'public admin registration denied');
  check((await post('/api/register', { email: 'new@web.test', phone: '+77016660006', password, full_name: 'New client', role: 'client', referral_code: '' })).status, 201, 'client registration');
  check((await post('/api/register', { email: 'newowner@web.test', phone: '+77016660007', password, full_name: 'New owner', role: 'company_owner', referral_code: '   ', company_name: 'New company', company_registration_number: '223456789012', company_city: 'Актау', company_address: 'Дом 2', company_phone: '+77016660007' })).status, 201, 'company registration');
  check((await post('/api/register', { email: 'newcleaner@web.test', phone: '+77016660008', password, full_name: 'New cleaner', role: 'cleaner', referral_code: community.code })).status, 201, 'cleaner registration');
  // Without a trusted proxy every visitor shares one rate-limit key: different
  // people must still be able to register and recover passwords.
  for (let i = 0; i < 8; i++) check((await post('/api/register', { email: `crowd${i}@web.test`, phone: `+7701667000${i}`, password, full_name: `Crowd ${i}`, role: 'client' })).status, 201, `registration #${i + 1} by a different person`);
  for (let i = 0; i < 8; i++) check((await post('/api/local/api', { action: 'recover', email: `crowd${i}@web.test`, redirectTo: `${base}/reset-password` })).status, 200, `password recovery #${i + 1} by a different person`);
  for (let i = 0; i < 5; i++) await post('/api/local/api', { action: 'recover', email: 'same@web.test', redirectTo: `${base}/reset-password` });
  check((await post('/api/local/api', { action: 'recover', email: 'same@web.test', redirectTo: `${base}/reset-password` })).status, 429, 'password recovery still limited per account');
  const logout = await post('/api/local/api', { action: 'signOut' }, adminCookie); check(logout.status, 200, 'logout');
  check((await post('/api/local/api', { action: 'getUser' }, adminCookie).then(r => r.json())).data.user, null, 'logout invalidates server session');
  check((await fetch(base + '/.env.local', { redirect: 'manual' })).status === 200, false, 'environment file inaccessible');
  console.log(`Web security and role checks passed: ${checks}`);
} finally {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)); }
  await app.close(); await rm(dir, { recursive: true, force: true });
}
