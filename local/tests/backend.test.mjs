import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../database.mjs';
import { startServer } from '../server.mjs';
import { createClient } from '../../packages/local-client/src/index.js';

test('local backend: migrations, auth, RLS, catalog, relations, files, recovery and persistence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cleaning-local-'));
  const key = 'test-key-'.repeat(8);
  let app = await startServer({ port: 0, dataDir: dir, serviceKey: key });
  const url = `http://127.0.0.1:${app.port}`;
  const admin = createClient(url, key),
    anon = createClient(url);
  const client = createClient(url),
    stranger = createClient(url);
  try {
    await assert.rejects(openDatabase(join(dir, 'db')), /already open/);
    assert.equal(
      (await app.db.query('select count(*) from local_migrations')).rows[0]
        .count,
      42,
    );
    let r = await anon.from('cleaning_services').select('*');
    assert.equal(r.error, null);
    assert.equal(r.data.length, 7);
    r = await anon.from('profiles').select('*');
    assert.ok(r.error);
    r = await anon.auth.admin.createUser({
      email: 'evil@example.test',
      password: 'password123',
    });
    assert.ok(r.error);
    const make = async (email) => {
      const r = await admin.auth.admin.createUser({
        email,
        password: 'password123',
        phone: email.startsWith('first') ? '+77010000001' : '+77010000002',
        user_metadata: { full_name: 'Тестовый клиент', role: 'client' },
      });
      assert.equal(r.error, null, JSON.stringify(r));
      return r.data.user;
    };
    const first = await make('first@example.test'),
      second = await make('second@example.test');
    r = await client.auth.signInWithPassword({
      email: first.email,
      password: 'wrong',
    });
    assert.ok(r.error);
    r = await client.auth.signInWithPassword({
      email: first.email,
      password: 'password123',
    });
    assert.equal(r.error, null);
    assert.equal(r.data.user.id, first.id);
    const cookies = [];
    const serverClient = createClient(url, '', {
      cookies: { getAll: () => [], setAll: (items) => cookies.push(...items) },
    });
    {
      const login = await serverClient.auth.signInWithPassword({
        email: first.email,
        password: 'password123',
      });
      assert.equal(login.error, null);
      const profile = await serverClient
        .from('profiles')
        .select('id')
        .eq('id', first.id)
        .single();
      assert.equal(profile.error, null);
      assert.ok(cookies[0].value);
    }
    await stranger.auth.signInWithPassword({
      email: second.email,
      password: 'password123',
    });
    r = await client
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', first.id)
      .select('*')
      .single();
    assert.equal(r.error, null);
    assert.equal(r.data.role, 'client');
    r = await client
      .from('addresses')
      .insert({
        user_id: first.id,
        city: 'Актау',
        address_line: 'Дом 1',
        label: 'Дом',
      })
      .select('*')
      .single();
    assert.equal(r.error, null, JSON.stringify(r));
    const address = r.data;
    assert.equal(
      (await stranger.from('addresses').select('*').eq('id', address.id)).data
        .length,
      0,
    );
    assert.ok(
      (
        await stranger
          .from('addresses')
          .insert({ user_id: first.id, city: 'Актау', address_line: 'Дом 2' })
      ).error,
    );
    r = await client
      .from('client_profiles')
      .select('user_id,company_profiles!preferred_company_id(id,name)')
      .eq('user_id', first.id)
      .single();
    assert.equal(r.error, null, JSON.stringify(r));
    assert.equal(r.data.company_profiles, null);
    r = await client
      .from('profiles')
      .select('id')
      .or(`email.eq.${first.email},id.in.(${second.id})`);
    assert.equal(r.error, null);
    assert.equal(r.data.length, 1);
    r = await client
      .from('profiles')
      .select('id', { count: 'exact', head: true });
    assert.equal(r.count, 1);
    const path = `${first.id}/test.png`;
    r = await client.storage
      .from('order-photos')
      .upload(path, new Blob([Buffer.from([137,80,78,71,13,10,26,10])], { type: 'image/png' }));
    assert.equal(r.error, null, JSON.stringify(r));
    assert.ok(
      (
        await stranger.storage
          .from('order-photos')
          .upload(path, new Blob([Buffer.from([137,80,78,71,13,10,26,10])], { type: 'image/png' }))
      ).error,
    );
    r = await client.storage.from('order-photos').createSignedUrls([path], 60);
    assert.equal(r.error, null);
    assert.deepEqual(Buffer.from(await (await fetch(r.data[0].signedUrl)).arrayBuffer()), Buffer.from([137,80,78,71,13,10,26,10]));
    r = await stranger.storage
      .from('order-photos')
      .createSignedUrls([path], 60);
    assert.equal(r.data[0].signedUrl, null);
    assert.ok(
      (
        await client.rpc('finalize_order_finances', {
          target_order_id: address.id,
        })
      ).error,
    );
    r = await client.rpc('choose_company', { target_company_id: null });
    assert.ok(r.error);
    await client.auth.resetPasswordForEmail(first.email);
    const mail = JSON.parse(
      await readFile(
        join(dir, 'mail', (await readdir(join(dir, 'mail')))[0]),
        'utf8',
      ),
    );
    const token = new URL(mail.link).searchParams.get('token_hash');
    const recovery = createClient(url);
    assert.equal(
      (await recovery.auth.verifyOtp({ token_hash: token })).error,
      null,
    );
    assert.ok((await recovery.auth.verifyOtp({ token_hash: token })).error);
    assert.equal(
      (await recovery.auth.updateUser({ password: 'new-password-123' })).error,
      null,
    );
    assert.equal((await client.auth.getUser()).data.user, null);
    assert.ok(
      (
        await client.auth.signInWithPassword({
          email: first.email,
          password: 'password123',
        })
      ).error,
    );
    assert.equal(
      (
        await client.auth.signInWithPassword({
          email: first.email,
          password: 'new-password-123',
        })
      ).error,
      null,
    );
    await client.auth.signOut();
    assert.equal((await client.auth.getUser()).data.user, null);
    await admin
      .from('profiles')
      .update({ status: 'blocked' })
      .eq('id', second.id);
    assert.equal((await stranger.auth.getUser()).data.user, null);
    await app.close();
    app = null;
    const db = await openDatabase(join(dir, 'db'));
    try {
      assert.equal(
        (await db.query('select count(*) from auth.users')).rows[0].count,
        2,
      );
    } finally {
      await db.close();
    }
  } finally {
    if (app) await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
