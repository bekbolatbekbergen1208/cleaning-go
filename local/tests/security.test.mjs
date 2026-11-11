import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server.mjs';
import { createClient } from '../../packages/local-client/src/index.js';
import { createLimiter } from '../security.mjs';

const ok = (r) => { assert.equal(r.error, null, JSON.stringify(r)); return r.data; };

test('rate limiter bounds random-key memory and expires limits', () => {
  const limiter = createLimiter(2);
  assert.equal(limiter.hit('one', 1, 60000), false);
  assert.equal(limiter.hit('one', 1, 60000), true);
  assert.equal(limiter.hit('two', 1, 60000), false);
  assert.equal(limiter.hit('random-third-key', 1, 60000), true);
});

test('security boundaries: malformed input, SQL injection, privacy, financial tampering, documents, files and recovery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cleaning-security-'));
  const key = 'security-test-key-'.repeat(4);
  const app = await startServer({ port: 0, dataDir: dir, serviceKey: key });
  const url = `http://127.0.0.1:${app.port}`;
  const admin = createClient(url, key);
  const client = createClient(url), stranger = createClient(url);
  const post = (body, headers = {}) => fetch(`${url}/api`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  try {
    for (const body of ['null', '[]', '{', '"string"', '{}', '{"action":"signIn","email":{},"password":{}}']) {
      const r = await post(body); assert.ok(r.status >= 400 && r.status < 500, `${body}: ${r.status}`);
    }
    assert.equal((await post({ action: 'getUser' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await post({ action: 'getUser' }, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await post({ action: 'getUser', padding: 'x'.repeat(66000) })).status, 413);
    assert.equal((await post({ action: 'createUser', user: {} }, { 'x-service-key': 'forged' })).status, 403);
    for (const [email, phone] of [['first@security.test', '+77015550001'], ['second@security.test', '+77015550002']]) {
      ok(await admin.auth.admin.createUser({ email, phone, password: 'password123', user_metadata: { role: 'client', full_name: 'Security test' } }));
    }
    const first = ok(await client.auth.signInWithPassword({ email: 'first@security.test', password: 'password123' }));
    const second = ok(await stranger.auth.signInWithPassword({ email: 'second@security.test', password: 'password123' }));
    const uid = first.user.id;
    assert.equal(ok(await client.from('profiles').select('id,email')).length, 1, 'unrelated client contact data stays private');
    assert.equal(ok(await client.from('profiles').select('*').eq('id', second.user.id)).length, 0);
    ok(await client.from('profiles').update({ role: 'admin', status: 'blocked', email: 'attacker@evil.test', phone: '+77019999999' }).eq('id', uid));
    const profile = ok(await client.from('profiles').select('role,status,email,phone').eq('id', uid).single());
    assert.equal(profile.role, 'client'); assert.equal(profile.status, 'active'); assert.equal(profile.email, 'first@security.test'); assert.equal(profile.phone, '+77015550001');
    ok(await admin.from('client_profiles').update({ company_locked: true }).eq('user_id', uid));
    ok(await client.from('client_profiles').update({ company_locked: false }).eq('user_id', uid));
    assert.equal(ok(await client.from('client_profiles').select('company_locked').eq('user_id', uid).single()).company_locked, true);
    ok(await client.from('client_profiles').delete().eq('user_id', uid));
    assert.ok(ok(await client.from('client_profiles').select('user_id').eq('user_id', uid).single()));
    assert.ok((await client.from('client_profiles').insert({ user_id: uid })).error);
    assert.ok((await client.from('wallets').update({ available_minor: 999999999 }).eq('owner_id', uid)).data === null);
    assert.equal(Number(ok(await client.from('wallets').select('available_minor').eq('owner_id', uid).single()).available_minor), 0);
    assert.ok((await client.from('profiles;drop table profiles').select('*')).error);
    assert.ok((await client.from('profiles').select('id').eq('id', "' OR 1=1 --")).error);
    assert.ok((await client.rpc('add_company_bonus', { target_client: uid })).error);
    assert.ok((await client.rpc('finalize_order_finances', { target_order_id: uid })).error);
    assert.ok((await client.from('profiles').select('id').in('id', Array(1001).fill(uid))).error);
    const community = ok(await admin.from('cleaner_communities').insert({ name: 'Security community', code: 'COM-SECURITY', created_by: uid }).select('*').single());
    const worker = ok(await admin.auth.admin.createUser({ email: 'worker@security.test', phone: '+77015550003', password: 'password123', user_metadata: { full_name: 'Public worker', role: 'cleaner', referral_code: community.code } })).user;
    ok(await admin.from('cleaner_profiles').update({ verification_status: 'approved' }).eq('user_id', worker.id));
    const directory = ok(await client.from('cleaner_profiles').select('user_id,profiles(full_name,email,phone,referral_code)').eq('user_id', worker.id).single());
    assert.equal(directory.profiles.full_name, 'Public worker');
    assert.equal(directory.profiles.email, null); assert.equal(directory.profiles.phone, null); assert.equal(directory.profiles.referral_code, null);
    const workerClient = createClient(url);
    ok(await workerClient.auth.signInWithPassword({ email: worker.email, password: 'password123' }));
    ok(await workerClient.from('cleaner_profiles').update({ rating: 5, reviews_count: 999 }).eq('user_id', worker.id));
    const rating = ok(await workerClient.from('cleaner_profiles').select('rating,reviews_count').eq('user_id', worker.id).single());
    assert.equal(Number(rating.rating), 0); assert.equal(rating.reviews_count, 0);
    const path = `${uid}/document.png`, bytes = Buffer.from([137,80,78,71,13,10,26,10]);
    assert.ok((await client.storage.from('order-photos').upload(path, new Blob(['<script>alert(1)</script>'], { type: 'image/png' }))).error);
    assert.ok((await client.storage.from('order-photos').upload(`${uid}/../escape.png`, new Blob([bytes], { type: 'image/png' }))).error);
    ok(await client.storage.from('verification-documents').upload(path, new Blob([bytes], { type: 'image/png' })));
    assert.ok((await client.from('verification_documents').insert({ owner_id: uid, document_type: 'id', storage_path: path, status: 'approved', reviewed_by: uid })).error);
    ok(await client.from('verification_documents').insert({ owner_id: uid, document_type: 'id', storage_path: path }));
    const signed = ok(await client.storage.from('verification-documents').createSignedUrls([path], 60))[0].signedUrl;
    assert.equal((await fetch(signed)).status, 200);
    const tampered = new URL(signed); tampered.searchParams.set('path', `${second.user.id}/document.png`);
    assert.equal((await fetch(tampered)).status, 403);
    const expired = new URL(signed); expired.searchParams.set('expires', 'NaN');
    assert.equal((await fetch(expired)).status, 403);
    assert.equal(ok(await stranger.storage.from('verification-documents').createSignedUrls([path], 60))[0].signedUrl, null);
    assert.ok((await client.auth.updateUser({ password: 'attacker-password' })).error, 'ordinary session cannot change password without the current password');
    ok(await client.auth.resetPasswordForEmail('first@security.test'));
    const mail = JSON.parse(await readFile(join(dir, 'mail', (await readdir(join(dir, 'mail')))[0]), 'utf8'));
    const recoveryToken = new URL(mail.link).searchParams.get('token_hash');
    const recovery = createClient(url);
    ok(await recovery.auth.verifyOtp({ token_hash: recoveryToken }));
    assert.ok((await recovery.from('profiles').select('*')).error, 'recovery sessions cannot access business data');
    ok(await recovery.auth.updateUser({ password: 'new-password-123' }));
    assert.equal((await client.auth.getUser()).data.user, null, 'password reset revokes old sessions');
    assert.ok((await createClient(url).auth.verifyOtp({ token_hash: recoveryToken })).error, 'recovery tokens are single use');
    const unprotected = await app.db.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity and c.relname<>'local_migrations'");
    assert.deepEqual(unprotected.rows, [], 'business tables all enforce RLS');
    assert.equal((await app.db.query("select has_function_privilege('authenticated','public.add_company_bonus(uuid,uuid,text,bigint,uuid,uuid,text)','EXECUTE') allowed")).rows[0].allowed, false);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
