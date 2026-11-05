import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveMobileEndpoints,
  createClient,
} from '../../packages/local-client/src/index.js';
test('Android endpoints resolve LAN host and preserve explicit remote configuration', () => {
  assert.deepEqual(
    resolveMobileEndpoints({
      apiUrl: 'http://127.0.0.1:54321',
      registrationUrl: 'http://127.0.0.1:3000/api/register',
      hostUri: '192.168.1.42:8081',
      isDevelopment: true,
    }),
    {
      apiUrl: 'http://192.168.1.42:54321',
      registrationUrl: 'http://192.168.1.42:3000/api/register',
      webUrl: 'http://192.168.1.42:3000',
    },
  );
  assert.equal(
    resolveMobileEndpoints({
      apiUrl: 'https://api.example.test',
      hostUri: '192.168.1.42:8081',
      isDevelopment: true,
      registrationUrl: 'https://app.example.test/api/register',
    }).apiUrl,
    'https://api.example.test',
  );
  assert.equal(
    resolveMobileEndpoints({ webOrigin: 'http://192.168.1.42:8081' })
      .registrationUrl,
    'http://192.168.1.42:3000/api/register',
  );
  assert.throws(
    () => resolveMobileEndpoints({ apiUrl: 'file:///private' }),
    /HTTP/,
  );
});
test('polling provides changed rows, old rows and separate event types; unsubscribe cancels callbacks', async () => {
  const original = global.fetch;
  let rows = [{ id: 'one', status: 'accepted' }];
  let reads = 0;
  const events = [];
  global.fetch = async () => {
    reads++;
    return {
      json: async () => ({ data: rows.map((r) => ({ ...r })), error: null }),
    };
  };
  const client = createClient('http://test.invalid', '', {
    pollIntervalMs: 15,
  });
  const channel = client
    .channel('orders')
    .on(
      'postgres_changes',
      { table: 'orders', schema: 'public', event: '*' },
      (payload) => events.push(payload),
    )
    .subscribe();
  async function until(predicate) {
    const end = Date.now() + 1500;
    while (!predicate()) {
      if (Date.now() > end) throw new Error('Timed out');
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  try {
    await until(() => reads > 0);
    await new Promise((r) => setTimeout(r, 10));
    rows = [{ id: 'one', status: 'on_the_way' }];
    await until(() => events.length === 1);
    assert.equal(events[0].new.status, 'on_the_way');
    assert.equal(events[0].old.status, 'accepted');
    assert.equal(events[0].eventType, 'UPDATE');
    rows = [...rows, { id: 'two', status: 'searching' }];
    await until(() => events.length === 2);
    assert.equal(events[1].eventType, 'INSERT');
    rows = [rows[1]];
    await until(() => events.length === 3);
    assert.equal(events[2].eventType, 'DELETE');
    assert.equal(events[2].old.id, 'one');
    await client.removeChannel(channel);
    rows = [];
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(events.length, 3);
  } finally {
    channel.unsubscribe();
    global.fetch = original;
  }
});
test('network timeout aborts login so a late response cannot unexpectedly sign in', async () => {
  const original = global.fetch;
  let signedIn = false;
  global.fetch = async (_url, { signal }) =>
    new Promise((_ok, fail) =>
      signal.addEventListener('abort', () =>
        fail(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      ),
    );
  try {
    const c = createClient('http://test.invalid', '', { requestTimeoutMs: 20 });
    c.auth.onAuthStateChange(() => {
      signedIn = true;
    });
    const r = await c.auth.signInWithPassword({
      email: 'a@example.test',
      password: 'password123',
    });
    assert.equal(r.error.status, 0);
    assert.equal(signedIn, false);
  } finally {
    global.fetch = original;
  }
});
