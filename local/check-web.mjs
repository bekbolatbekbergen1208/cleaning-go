import assert from 'node:assert/strict';
const origin = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
for (const path of ['/', '/login', '/register', '/reset-password']) {
  const r = await fetch(`${origin}${path}`);
  assert.equal(r.status, 200, path);
  console.log(`PASS public ${path}`);
}
let r = await fetch(`${origin}/profile`, { redirect: 'manual' });
assert.equal(r.status, 307);
assert.ok(r.headers.get('location').endsWith('/login'));
console.log('PASS unauthenticated redirect');
r = await fetch(`${origin}/api/auth/login`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: 'https://invalid.example',
  },
  body: JSON.stringify({ email: 'invalid', password: 'invalid' }),
});
assert.equal(r.status, 403);
console.log('PASS cross-origin login rejected');
r = await fetch(`${origin}/api/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin },
  body: JSON.stringify({
    email: 'forbidden@example.test',
    password: 'password123',
    full_name: 'Test Admin',
    phone: '+77030000001',
    role: 'admin',
  }),
});
assert.equal(r.status, 400);
console.log('PASS public admin registration rejected');
r = await fetch(`${origin}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin },
  body: JSON.stringify({
    email: process.env.SEED_ADMIN_EMAIL,
    password: process.env.SEED_ADMIN_PASSWORD,
  }),
});
const login = await r.json();
assert.equal(r.status, 200, JSON.stringify(login));
assert.equal(login.destination, '/admin');
const cookie = r.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .filter((c) => !c.endsWith('='))
  .join('; ');
assert.ok(cookie.includes('cleaning-go-session='));
console.log('PASS server login and session cookie');
for (const path of [
  '/admin',
  '/users',
  '/services',
  '/settings',
  '/moderation',
  '/verifications',
  '/orders',
  '/communities',
  '/companies',
]) {
  const response = await fetch(`${origin}${path}`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  const html = await response.text();
  assert.equal(response.status, 200, path);
  assert.ok(!html.includes('id="__next_error__"'), path);
  console.log(`PASS admin ${path}`);
}
