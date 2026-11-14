// Full user journey over the same HTTP endpoints/forms used by the website.
// Only the first administrator is bootstrapped; every other account registers publicly.
import assert from 'node:assert/strict';
import { randomBytes, randomInt } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  mkdtemp,
  rm,
  writeFile,
  readFile,
  readdir,
  chmod,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startServer } from '../local/server.mjs';
import { createClient } from '../packages/local-client/src/index.js';
const require = createRequire(
  new URL('../apps/admin/package.json', import.meta.url),
);
const live = process.env.CLEANING_GO_LIVE_QA === 'yes';
if (live) {
  assert.ok(
    process.env.PUBLIC_APP_URL &&
      process.env.LOCAL_API_URL &&
      process.env.LOCAL_DATA_ROOT &&
      process.env.LOCAL_SERVICE_KEY,
  );
  assert.equal(
    process.env.CLEANING_GO_QA_TARGET,
    process.env.PUBLIC_APP_URL,
    'Explicit live QA target required',
  );
}
const dir = live
  ? process.env.LOCAL_DATA_ROOT
  : await mkdtemp(join(tmpdir(), 'cleaning-functional-'));
const key = live
  ? process.env.LOCAL_SERVICE_KEY
  : 'functional-test-service-key-'.repeat(3);
const app = live
  ? null
  : await startServer({ port: 0, dataDir: dir, serviceKey: key });
const db = createClient(
  live ? process.env.LOCAL_API_URL : `http://127.0.0.1:${app.port}`,
  key,
);
const base = live ? process.env.PUBLIC_APP_URL : 'http://127.0.0.1:3108';
const password = live
  ? randomBytes(24).toString('base64url')
  : 'Functional-test-password-123';
const resetPassword = live
  ? randomBytes(24).toString('base64url')
  : 'Functional-new-password-123';
const runId = live ? randomBytes(4).toString('hex') : '';
const phoneBase = randomInt(1000000, 8999990);
let phoneIndex = 0;
const credentials = [];
async function saveCredentials() {
  if (!live) return;
  const path = process.env.CLEANING_GO_QA_CREDENTIALS;
  assert.ok(path, 'Private credential output path required in live QA mode');
  await writeFile(
    path,
    JSON.stringify({ target: base, runId, accounts: credentials }, null, 2) +
      '\n',
    { mode: 0o600 },
  );
  await chmod(path, 0o600);
}
const results = [],
  orders = [];
let child,
  logs = '';
const record = (label) => {
  results.push(label);
  console.log(`PASS ${label}`);
};
const check = (value, label) => {
  assert.ok(value, label);
  record(label);
};
const ok = (r) => {
  assert.equal(r.error, null, JSON.stringify(r));
  return r.data;
};
const post = (path, body, cookie = '') =>
  fetch(base + path, {
    method: 'POST',
    headers: { origin: base, cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
async function api(account, body) {
  const r = await post('/api/local/api', body, account.cookie);
  const data = await r.json();
  assert.ok(r.ok, JSON.stringify(data));
  return ok(data);
}
const rpc = (account, name, args = {}) =>
  api(account, { action: 'rpc', name, args });
const query = (account, plan) => api(account, { action: 'query', plan });
async function page(account, path, contains) {
  const r = await fetch(base + path, {
    headers: { cookie: account.cookie },
    redirect: 'manual',
  });
  assert.equal(
    r.status,
    200,
    `${path}: ${r.status} ${r.headers.get('location')}`,
  );
  const html = await r.text();
  assert.ok(!/"digest":"[0-9]+"/.test(html), `${path}: server render error`);
  if (contains)
    assert.ok(html.includes(contains), `${path} missing ${contains}`);
  return html;
}
const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
function fields(form) {
  const data = new FormData();
  for (const input of form.matchAll(/<input\b[^>]*>/g)) {
    const attrs = Object.fromEntries(
      [...input[0].matchAll(/([\w$:-]+)="([^"]*)"/g)].map((m) => [
        m[1],
        decode(m[2]),
      ]),
    );
    if (attrs.name && attrs.type !== 'checkbox' && attrs.type !== 'file')
      data.append(attrs.name, attrs.value || '');
  }
  return data;
}
async function submitForm(account, path, predicate, values, label) {
  const html = await page(account, path);
  const form = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)]
    .map((x) => x[0])
    .find(predicate);
  assert.ok(form, `No form: ${label}`);
  const data = fields(form);
  assert.ok(
    [...data.keys()].some((x) => x.startsWith('$ACTION_')),
    `No server action: ${label}`,
  );
  for (const [name, value] of Object.entries(values))
    data.set(name, String(value));
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { origin: base, cookie: account.cookie },
    body: data,
    redirect: 'manual',
  });
  const body = await r.text();
  assert.ok(
    r.status < 400 && !/"digest":"[0-9]+"/.test(body),
    `${label}: ${r.status} ${body.slice(-300)}\n${logs.slice(-1000)}`,
  );
  record(label);
}
async function login(email, loginPassword = password) {
  const r = await post('/api/auth/login', { email, password: loginPassword });
  const body = await r.json();
  assert.equal(r.status, 200, `${email}: ${JSON.stringify(body)}`);
  const cookie = r.headers
    .getSetCookie()
    .filter((x) => x.startsWith('cleaning-go-session='))
    .at(-1)
    ?.split(';')[0];
  assert.ok(cookie);
  const account = { email, cookie };
  account.user = (await api(account, { action: 'getUser' })).user;
  record(`login ${email}`);
  return account;
}
async function register(name, role, phone, extra = {}) {
  const email = `${name}${live ? '.' + runId : ''}@functional.test`;
  if (live) {
    phone = '+7701' + String(phoneBase + ++phoneIndex);
    if (role === 'company_owner')
      extra = {
        ...extra,
        company_name: `QA Cleaning ${runId}`,
        company_phone: phone,
        company_registration_number:
          '999' + String(randomInt(100000000, 999999999)),
      };
  }
  const r = await post('/api/register', {
    email,
    password,
    full_name: `QA ${name}`,
    phone,
    role,
    referral_code: '',
    ...extra,
  });
  const body = await r.json();
  assert.equal(r.status, 201, `register ${role}: ${JSON.stringify(body)}`);
  if (live) {
    credentials.push({ email, role, password });
    await saveCredentials();
  }
  record(`public registration ${role}: ${name}`);
  return login(email);
}
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=',
  'base64',
);
async function upload(account, path) {
  const r = await fetch(base + '/api/local/upload', {
    method: 'POST',
    headers: {
      origin: base,
      cookie: account.cookie,
      'content-type': 'image/png',
      'x-bucket': 'order-photos',
      'x-path': path,
    },
    body: png,
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).error, null);
  return path;
}
async function orderRow(id) {
  return ok(await db.from('orders').select('*').eq('id', id).single());
}
async function newOrder(client, company, cleanerId = null, extra = {}) {
  const photo = await upload(
    client,
    `${client.user.id}/room-${orders.length}.png`,
  );
  const address = await query(client, {
    table: 'addresses',
    operation: 'insert',
    values: {
      user_id: client.user.id,
      label: 'QA',
      city: 'Актау',
      address_line: 'QA address 1',
      latitude: 43.65,
      longitude: 51.16,
    },
    returning: true,
    single: 'required',
  });
  const payload = {
    service_id: '10000000-0000-0000-0000-000000000001',
    address_id: address.id,
    selected_company_id: cleanerId ? null : company.id,
    selected_cleaner_id: cleanerId,
    scheduled_at: new Date(Date.now() + 86400000).toISOString(),
    area_sq_m: 50,
    rooms_count: 2,
    executor_preference: cleanerId ? 'cleaner' : 'company',
    payment_method: 'cash',
    option_ids: [],
    photo_urls: [photo],
    ...extra,
  };
  const order = await rpc(
    client,
    extra.bonus_amount_minor ? 'create_order_with_bonus' : 'create_order',
    { payload },
  );
  orders.push({ id: order.id, number: order.order_number });
  await page(client, '/profile/orders', order.order_number);
  record(`order created and visible: ${order.order_number}`);
  return order;
}
try {
  let adminUser;
  if (live) {
    assert.ok(process.env.SEED_ADMIN_EMAIL && process.env.SEED_ADMIN_PASSWORD);
    adminUser = { email: process.env.SEED_ADMIN_EMAIL };
    assert.equal(
      (await fetch(base + '/login')).status,
      200,
      'Live website ready',
    );
  } else {
    adminUser = ok(
      await db.auth.admin.createUser({
        email: 'qa-admin@functional.test',
        password,
        user_metadata: { role: 'client', full_name: 'QA Administrator' },
      }),
    ).user;
    ok(
      await db
        .from('profiles')
        .update({ role: 'admin' })
        .eq('id', adminUser.id),
    );
    child = spawn(
      process.execPath,
      [
        require.resolve('next/dist/bin/next'),
        'start',
        '--hostname',
        '127.0.0.1',
        '--port',
        '3108',
      ],
      {
        cwd: fileURLToPath(new URL('../apps/admin/', import.meta.url)),
        env: {
          ...process.env,
          NODE_ENV: 'production',
          LOCAL_API_URL: `http://127.0.0.1:${app.port}`,
          LOCAL_SERVICE_KEY: key,
          PUBLIC_APP_URL: base,
          SEED_ADMIN_EMAIL: adminUser.email,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout.on('data', (x) => {
      logs += x;
    });
    child.stderr.on('data', (x) => {
      logs += x;
    });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + '/login')).ok) {
          ready = true;
          break;
        }
      } catch {}
      if (child.exitCode !== null) throw new Error(logs);
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, 'Web server start');
  }
  if (!live) {
    const home = await fetch(base + '/').then((response) => response.text());
    check(home.includes('Заказы пока недоступны'), 'empty marketplace is disclosed on home page');
  }
  const admin = await login(
    adminUser.email,
    live ? process.env.SEED_ADMIN_PASSWORD : password,
  );
  const owner = await register('company', 'company_owner', '+77017770001', {
    company_name: 'QA Cleaning Company',
    company_registration_number: '333456789012',
    company_city: 'Актау',
    company_address: 'QA office 1',
    company_phone: '+77017770001',
  });
  let company = ok(
    await db
      .from('company_profiles')
      .select('*')
      .eq('owner_id', owner.user.id)
      .single(),
  );
  check(
    company.verification_status === 'pending',
    'new company awaits verification',
  );
  await submitForm(
    admin,
    '/verifications',
    (f) => f.includes(company.id) && f.includes('Подтвердить'),
    {},
    'administrator approves company through web form',
  );
  company = ok(
    await db.from('company_profiles').select('*').eq('id', company.id).single(),
  );
  check(company.verification_status === 'approved', 'company approval saved');
  if (!live) {
    const home = await fetch(base + '/').then((response) => response.text());
    check(!home.includes('Заказы пока недоступны'), 'booking notice disappears after company approval');
  }
  await submitForm(
    admin,
    '/communities',
    (f) => f.includes('Создать сообщество'),
    {
      name: `QA functional community${live ? ' ' + runId : ''}`,
      description: 'Isolated full journey',
    },
    'administrator creates community through web form',
  );
  const community = ok(
    await db
      .from('cleaner_communities')
      .select('*')
      .eq('name', `QA functional community${live ? ' ' + runId : ''}`)
      .single(),
  );
  await submitForm(
    owner,
    '/company',
    (f) => f.includes('name="community_code"'),
    { community_code: community.code },
    'company joins community through web form',
  );
  const cleaner = await register('cleaner', 'cleaner', '+77017770002', {
    referral_code: community.code,
  });
  for (const account of [cleaner]) {
    await submitForm(
      admin,
      '/verifications',
      (f) => f.includes(account.user.id) && f.includes('Подтвердить'),
      {},
      `administrator approves ${account.email}`,
    );
    await rpc(account, 'set_cleaner_workday', {
      target_active: true,
      duration_hours: 8,
    });
    await page(account, '/cleaner/company-orders');
    record(`active shift ${account.email}`);
  }
  const client = await register('client', 'client', '+77017770004');
  await page(client, '/profile/company');
  await rpc(client, 'choose_company', { target_company_id: company.id });
  await rpc(client, 'apply_invitation_code', {
    input_code: company.company_code,
  });
  const invite = (
    await query(client, {
      table: 'referral_codes',
      columns: 'code',
      filters: [{ column: 'owner_id', op: 'eq', value: client.user.id }],
      single: 'required',
    })
  ).code;
  const referred = await register('referred', 'client', '+77017770005', {
    referral_code: invite,
  });
  const linked = await query(referred, {
    table: 'client_profiles',
    columns: 'preferred_company_id,company_locked',
    filters: [{ column: 'user_id', op: 'eq', value: referred.user.id }],
    single: 'required',
  });
  check(
    linked.preferred_company_id === company.id && linked.company_locked,
    'referral registration links correct company',
  );
  const balanceBefore = Number(
    (
      await query(client, {
        table: 'company_bonus_balances',
        columns: 'balance_minor',
        filters: [
          { column: 'client_id', op: 'eq', value: client.user.id },
          { column: 'company_id', op: 'eq', value: company.id },
        ],
        single: 'required',
      })
    ).balance_minor,
  );
  check(balanceBefore > 0, 'welcome/referral bonuses credited');
  const order = await newOrder(client, company, null, {
    bonus_amount_minor: Math.min(balanceBefore, 50000),
  });
  await page(owner, '/company/orders', order.order_number);
  await submitForm(
    owner,
    '/company/orders',
    (f) => f.includes(order.id) && f.includes('name="total_kzt"'),
    {
      order_id: order.id,
      total_kzt: 10000,
      required_workers: 1,
      cleaner_amount_kzt: 5000,
    },
    'company proposes price through web form',
  );
  check(
    (await orderRow(order.id)).status === 'offered',
    'price awaits client consent',
  );
  const oldQuoteHtml = await page(client, '/profile');
  const oldQuoteForm = [...oldQuoteHtml.matchAll(/<form\b[\s\S]*?<\/form>/g)]
    .map((x) => x[0])
    .find((f) => f.includes(order.id) && f.includes('Подтвердить цену'));
  assert.ok(oldQuoteForm);
  await rpc(owner, 'propose_company_order_price', {
    target_order_id: order.id,
    target_total_minor: 1200000,
    target_required_workers: 1,
    target_cleaner_amount_minor: 500000,
  });
  record('company revises quote through API while client has old form');
  const staleResponse = await fetch(base + '/profile', {
    method: 'POST',
    headers: { origin: base, cookie: client.cookie },
    body: fields(oldQuoteForm),
    redirect: 'manual',
  });
  const staleBody = await staleResponse.text();
  check(
    staleResponse.status === 200 &&
      staleBody.includes('Цена заказа изменилась') &&
      (await orderRow(order.id)).status === 'offered',
    'old price form cannot confirm a revised quote',
  );
  await submitForm(
    client,
    '/profile',
    (f) => f.includes(order.id) && f.includes('Подтвердить цену'),
    { order_id: order.id },
    'client confirms price through web form',
  );
  const confirmed = await orderRow(order.id);
  check(
    confirmed.status === 'accepted' &&
      Number(confirmed.company_bonus_used_minor) ===
        Math.min(balanceBefore, 50000),
    'confirmed order debits correct bonus once',
  );
  await page(cleaner, '/cleaner/company-orders', order.order_number);
  await submitForm(
    cleaner,
    '/cleaner/company-orders',
    (f) => f.includes(order.id) && f.includes('Взять заказ'),
    { order_id: order.id },
    'cleaner claims order through web form',
  );
  const blocked = await post(
    '/api/local/api',
    {
      action: 'rpc',
      name: 'claim_company_order',
      args: { target_order_id: order.id },
    },
    owner.cookie,
  ).then((r) => r.json());
  check(Boolean(blocked.error), 'company owner cannot claim a cleaner place');
  const stepHtml = await page(cleaner, '/cleaner/company-orders');
  const repeatedStepForm = [...stepHtml.matchAll(/<form\b[\s\S]*?<\/form>/g)]
    .map((x) => x[0])
    .find((f) => f.includes(order.id) && f.includes('name="expected_status"'));
  assert.ok(repeatedStepForm);
  for (const status of ['on_the_way', 'arrived', 'in_progress']) {
    await submitForm(
      cleaner,
      '/cleaner/company-orders',
      (f) =>
        f.includes(order.id) &&
        f.includes('$ACTION_') &&
        !f.includes('Взять заказ') &&
        !f.includes('name="photos"'),
      { order_id: order.id },
      `cleaner advances through web form: ${status}`,
    );
    check(
      (await orderRow(order.id)).status === status,
      `status persisted: ${status}`,
    );
    if (status === 'on_the_way') {
      const retry = await fetch(base + '/cleaner/company-orders', {
        method: 'POST',
        headers: { origin: base, cookie: cleaner.cookie },
        body: fields(repeatedStepForm),
        redirect: 'manual',
      });
      await retry.text();
      check(
        retry.status === 200 &&
          (await orderRow(order.id)).status === 'on_the_way',
        'replayed web form does not skip a stage',
      );
    }
    if (status === 'on_the_way') {
      const r = await post(
        `/api/orders/${order.id}/tracking`,
        { latitude: 43.651, longitude: 51.161, heading: 90, speed: 1 },
        cleaner.cookie,
      );
      check(r.status === 200, 'cleaner sends GPS through web endpoint');
      const track = await fetch(base + `/api/orders/${order.id}/tracking`, {
        headers: { cookie: client.cookie },
      }).then((r) => r.json());
      check(
        track.locations?.length === 1,
        'client receives assigned cleaner GPS',
      );
    }
  }
  const completion = await upload(
    cleaner,
    `${cleaner.user.id}/completion-${order.id}-report.png`,
  );
  await rpc(cleaner, 'advance_company_order', {
    target_order_id: order.id,
    completion_paths: [completion],
    expected_status: 'in_progress',
  });
  const profile = await page(client, '/profile', order.order_number);
  check(
    profile.includes('/api/local/file?'),
    'client profile renders signed photo report on web origin',
  );
  await submitForm(
    client,
    '/profile',
    (f) => f.includes(order.id) && f.includes('Подтвердить завершение'),
    { order_id: order.id },
    'client confirms completion through web form',
  );
  const complete = await orderRow(order.id);
  check(
    complete.status === 'completed' &&
      complete.payment_status === 'paid' &&
      complete.finances_finalized_at,
    'cash order completed and finances finalized',
  );
  await page(client, `/order/${order.id}/review`);
  const review = await rpc(client, 'create_review', {
    target_order_id: order.id,
    target_rating: 5,
    target_text: 'QA full journey passed',
    target_tags: [],
  });
  const repeated = await rpc(client, 'create_review', {
    target_order_id: order.id,
    target_rating: 5,
    target_text: 'Retry',
    target_tags: [],
  });
  check(review.id === repeated.id, 'review retry creates no duplicate');
  const rating = ok(
    await db
      .from('cleaner_profiles')
      .select('rating,reviews_count')
      .eq('user_id', cleaner.user.id)
      .single(),
  );
  check(
    Number(rating.rating) === 5 && rating.reviews_count === 1,
    'review updates cleaner rating',
  );
  await submitForm(
    admin,
    '/moderation',
    (f) => f.includes(review.id) && f.includes('Скрыть'),
    { visible: 'false' },
    'administrator hides review through web form',
  );
  let moderated = ok(
    await db
      .from('cleaner_profiles')
      .select('rating,reviews_count')
      .eq('user_id', cleaner.user.id)
      .single(),
  );
  check(
    Number(moderated.rating) === 0 && moderated.reviews_count === 0,
    'hidden review removed from cleaner rating',
  );
  check(
    Number(
      ok(
        await db
          .from('company_profiles')
          .select('rating')
          .eq('id', company.id)
          .single(),
      ).rating,
    ) === 0,
    'hidden review removed from company rating',
  );
  await submitForm(
    admin,
    '/moderation',
    (f) => f.includes(review.id) && f.includes('Восстановить'),
    { visible: 'true' },
    'administrator restores review through web form',
  );
  moderated = ok(
    await db
      .from('cleaner_profiles')
      .select('rating,reviews_count')
      .eq('user_id', cleaner.user.id)
      .single(),
  );
  check(
    Number(moderated.rating) === 5 && moderated.reviews_count === 1,
    'restored review included in rating',
  );
  await page(owner, '/company/reports');
  await page(admin, '/orders', order.order_number);
  record('completed order visible in reports and administration');
  const cancel = await newOrder(client, company);
  await submitForm(
    client,
    '/profile',
    (f) => f.includes(cancel.id) && f.includes('Отменить заказ'),
    { order_id: cancel.id },
    'client cancels order through web form',
  );
  check(
    (await orderRow(cancel.id)).status === 'cancelled',
    'cancelled order persisted',
  );
  const directClient = await register(
    'direct-client',
    'client',
    '+77017770003',
  );
  await rpc(directClient, 'choose_company', { target_company_id: company.id });
  const direct = await newOrder(directClient, company, cleaner.user.id);
  check(
    direct.selected_cleaner_id === cleaner.user.id &&
      direct.selected_company_id === null,
    'unlocked client can choose an independent cleaner',
  );
  await submitForm(
    cleaner,
    '/cleaner/direct-orders',
    (f) => f.includes(direct.id) && f.includes('Принять заказ'),
    { order_id: direct.id },
    'cleaner accepts direct order through web form',
  );
  for (const status of ['accepted', 'on_the_way', 'arrived', 'in_progress']) {
    await submitForm(
      cleaner,
      '/cleaner/direct-orders',
      (f) => f.includes(direct.id) && f.includes('name="status"'),
      { order_id: direct.id, status },
      `direct order advances from ${status}`,
    );
  }
  await submitForm(
    directClient,
    '/profile',
    (f) => f.includes(direct.id) && f.includes('Подтвердить завершение'),
    { order_id: direct.id },
    'client confirms direct order completion',
  );
  check(
    (await orderRow(direct.id)).status === 'completed',
    'direct order fully completed',
  );
  const card = await newOrder(directClient, company, cleaner.user.id, {
    payment_method: 'card',
  });
  await rpc(cleaner, 'accept_order', { target_order_id: card.id });
  for (const next_status of [
    'on_the_way',
    'arrived',
    'in_progress',
    'completed_by_cleaner',
  ])
    await rpc(cleaner, 'transition_order_status', {
      target_order_id: card.id,
      next_status,
    });
  await rpc(directClient, 'transition_order_status', {
    target_order_id: card.id,
    next_status: 'completed',
  });
  const pending = await orderRow(card.id);
  check(
    pending.payment_status === 'pending' && !pending.finances_finalized_at,
    'unconnected card payment remains pending without false payout',
  );
  await rpc(client, 'open_dispute', {
    target_order_id: order.id,
    target_reason: 'poor_quality',
    target_description: 'QA test dispute',
  });
  await page(admin, '/moderation', 'QA test dispute');
  record('dispute reaches administrator moderation');
  await rpc(cleaner, 'set_cleaner_workday', {
    target_active: false,
    duration_hours: 8,
  });
  const stopped = await post(
    '/api/local/api',
    {
      action: 'rpc',
      name: 'update_cleaner_location',
      args: { target_order_id: card.id, lat: 43.65, lng: 51.16 },
    },
    cleaner.cookie,
  ).then((r) => r.json());
  check(Boolean(stopped.error), 'GPS rejected after shift/order completion');
  const recovery = await post('/api/local/api', {
    action: 'recover',
    email: client.email,
  });
  check(recovery.status === 200, 'password recovery request accepted');
  const mails = (await readdir(join(dir, 'mail'))).sort().reverse();
  let mail;
  for (const name of mails) {
    const candidate = JSON.parse(
      await readFile(join(dir, 'mail', name), 'utf8'),
    );
    if (candidate.to === client.email) {
      mail = candidate;
      break;
    }
  }
  assert.ok(mail, 'Recovery mail for the test client');
  const reset = await post('/api/local/api', {
    action: 'verifyRecovery',
    token_hash: new URL(mail.link).searchParams.get('token_hash'),
  });
  assert.equal(reset.status, 200);
  const recoveryCookie = reset.headers
    .getSetCookie()
    .filter((x) => x.startsWith('cleaning-go-session='))
    .at(-1)
    .split(';')[0];
  const changed = await post(
    '/api/local/api',
    { action: 'updateUser', password: resetPassword },
    recoveryCookie,
  ).then((r) => r.json());
  check(!changed.error, 'password reset succeeds');
  const old = await post(
    '/api/local/api',
    { action: 'getUser' },
    client.cookie,
  ).then((r) => r.json());
  check(old.data.user === null, 'password reset revokes previous session');
  const fresh = await post('/api/auth/login', {
    email: client.email,
    password: resetPassword,
  });
  check(fresh.status === 200, 'new password can log in');
  if (live) {
    credentials.find((x) => x.email === client.email).password = resetPassword;
    await saveCredentials();
  }
  const report = {
    date: '2026-11-11',
    target: base,
    mode: live ? 'live-public-site' : 'isolated',
    runId: runId || undefined,
    transport:
      'HTTP web endpoints and rendered server-action forms; no browser clicking',
    accountsRegistered: 5,
    checks: results.length,
    results,
    orders,
  };
  if (process.argv[2])
    await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
  console.log(
    `FUNCTIONAL JOURNEY PASSED: ${results.length} checks; 5 public registrations; ${orders.length} orders`,
  );
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((r) => child.once('exit', r));
  }
  if (!live) {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
}
