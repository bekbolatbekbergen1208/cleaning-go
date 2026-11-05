import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(
  readFileSync('apps/mobile/src/lib/background-location.ts', 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
function setup() {
  let task,
    removed = 0,
    watcherRemoved = 0,
    bgPermissionRequests = 0;
  let sessionError = null;
  let orderVisible = true;
  const query = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    async single() {
      return {
        data: {
          is_available: true,
          workday_ends_at: new Date(Date.now() + 3600000).toISOString(),
          status: 'accepted',
          cleaner_id: 'cleaner',
        },
      };
    },
    async maybeSingle() {
      return {
        data: orderVisible
          ? { status: 'accepted', cleaner_id: 'cleaner' }
          : null,
        error: null,
      };
    },
  };
  const backend = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: 'cleaner' } } },
        error: sessionError,
      }),
      getUser: async () => ({ data: { user: { id: 'cleaner' } }, error: null }),
    },
    from: () => query,
    rpc: async () => ({ error: null }),
  };
  const storage = {
    getItem: async () => 'order',
    removeItem: async () => {
      removed++;
    },
    setItem: async () => {},
  };
  const location = {
    Accuracy: { High: 1 },
    requestForegroundPermissionsAsync: async () => ({ granted: true }),
    requestBackgroundPermissionsAsync: async () => {
      bgPermissionRequests++;
      return { granted: false };
    },
    getCurrentPositionAsync: async () => ({
      coords: { latitude: 43.65, longitude: 51.16 },
    }),
    watchPositionAsync: async () => ({
      remove() {
        watcherRemoved++;
      },
    }),
  };
  const dependencies = {
    '@react-native-async-storage/async-storage': { default: storage },
    'expo-location': location,
    'expo-task-manager': {
      defineTask: (_name, fn) => {
        task = fn;
      },
      isAvailableAsync: async () => false,
    },
    'react-native': { Platform: { OS: 'android' } },
    './backend': { backend },
  };
  const exports = {};
  new Function('require', 'exports', source)(
    (name) => dependencies[name],
    exports,
  );
  return {
    exports,
    task: () => task,
    counts: () => ({ removed, watcherRemoved, bgPermissionRequests }),
    offline: () => {
      sessionError = { status: 0, message: 'offline' };
    },
    removeOrder: () => {
      orderVisible = false;
    },
  };
}
test('Android falls back to foreground tracking when background tasks are unavailable', async () => {
  const s = setup();
  assert.equal(await s.exports.startOrderTracking('order'), 'foreground');
  assert.equal(await s.exports.isTrackingOrder('order'), true);
  assert.equal(s.counts().bgPermissionRequests, 0);
  await s.exports.stopOrderTracking();
  assert.equal(s.counts().watcherRemoved, 1);
  assert.equal(await s.exports.isTrackingOrder('order'), false);
});
test('GPS task preserves tracking through network failure, but stops after order access is revoked', async () => {
  const payload = {
    data: { locations: [{ coords: { latitude: 43.65, longitude: 51.16 } }] },
  };
  const offline = setup();
  offline.offline();
  await offline.task()(payload);
  assert.equal(offline.counts().removed, 0);
  const revoked = setup();
  revoked.removeOrder();
  await revoked.task()(payload);
  assert.equal(revoked.counts().removed, 1);
});
