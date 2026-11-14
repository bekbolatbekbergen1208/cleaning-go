import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server.mjs';

// The web app proxies every visitor through the Next.js server, so the API sees
// one loopback address for the whole site. Limits keyed only by that address
// must not lock all users out; per-account limits must still apply.
test('loopback (Next.js) traffic is not throttled as if it were one user', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cleaning-shared-limits-'));
  const app = await startServer({ port: 0, dataDir: dir, serviceKey: 'shared-limit-key-'.repeat(4) });
  const url = `http://127.0.0.1:${app.port}`;
  const call = (body) =>
    fetch(`${url}/api`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    for (let i = 0; i < 10; i++) {
      const r = await call({ action: 'recover', email: `person${i}@example.test` });
      assert.equal(r.status, 200, `password recovery for person #${i + 1} was blocked`);
    }
    for (let i = 0; i < 5; i++) assert.equal((await call({ action: 'recover', email: 'same@example.test' })).status, 200);
    assert.equal((await call({ action: 'recover', email: 'same@example.test' })).status, 429, 'per-account limit');

    for (let i = 0; i < 25; i++) {
      const r = await call({ action: 'verifyRecovery', token_hash: i.toString(16).padStart(64, '0') });
      assert.equal(r.status, 400, `recovery link check #${i + 1} was rate limited`);
    }

    const statuses = new Set();
    for (let batch = 0; batch < 13; batch++)
      (await Promise.all(Array.from({ length: 100 }, () => fetch(`${url}/health`)))).forEach((r) => statuses.add(r.status));
    assert.deepEqual([...statuses], [200], 'site-wide traffic above 1200 requests/minute was blocked');
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
