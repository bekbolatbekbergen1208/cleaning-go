import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server.mjs';
import { createClient } from '../../packages/local-client/src/index.js';

// Every web login reaches the API from the same Next.js server address.
// Successful logins must never exhaust a shared limit, while repeated wrong
// passwords for one account are still throttled.
test('login limit counts only failures per account and never blocks the whole site', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cleaning-login-'));
  const key = 'test-key-'.repeat(8);
  const app = await startServer({ port: 0, dataDir: dir, serviceKey: key });
  const url = `http://127.0.0.1:${app.port}`;
  const admin = createClient(url, key);
  try {
    for (const [email, phone] of [
      ['one@example.test', '+77010000011'],
      ['two@example.test', '+77010000012'],
    ]) {
      const r = await admin.auth.admin.createUser({
        email,
        phone,
        password: 'password123',
        user_metadata: { full_name: 'Тест', role: 'client' },
      });
      assert.equal(r.error, null, JSON.stringify(r));
    }
    for (let i = 0; i < 30; i++) {
      const r = await createClient(url).auth.signInWithPassword({
        email: 'one@example.test',
        password: 'password123',
      });
      assert.equal(r.error, null, `successful login #${i + 1} was blocked`);
    }
    for (let i = 0; i < 10; i++) {
      const r = await createClient(url).auth.signInWithPassword({
        email: 'two@example.test',
        password: 'wrong-password',
      });
      assert.equal(r.error?.status, 401);
    }
    let r = await createClient(url).auth.signInWithPassword({
      email: 'two@example.test',
      password: 'password123',
    });
    assert.equal(r.error?.status, 429, 'brute force must stay throttled');
    r = await createClient(url).auth.signInWithPassword({
      email: 'one@example.test',
      password: 'password123',
    });
    assert.equal(r.error, null, 'other accounts must not be affected');
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
