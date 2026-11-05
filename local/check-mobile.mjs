import assert from 'node:assert/strict';
const web = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
const api = process.env.LOCAL_PUBLIC_API_URL || 'http://127.0.0.1:54321';
const host = new URL(api).hostname;
let r = await fetch(`${api}/health`);
assert.equal(r.status, 200);
assert.equal((await r.json()).database, 'local-postgresql');
console.log('PASS Android LAN API');
const manifestURL = `http://${host}:8081`;
r = await fetch(manifestURL, {
  headers: {
    'expo-platform': 'android',
    accept: 'application/expo+json',
    'expo-protocol-version': '1',
  },
});
assert.equal(r.status, 200);
const manifest = await r.json();
assert.ok(manifest.launchAsset?.url.includes(host));
assert.equal(manifest.extra.expoClient.android.package, 'kz.cleaninggo.app');
console.log('PASS Android Expo manifest and LAN bundle URL');
const mobileWeb = `http://${host}:8081`;
r = await fetch(`${web}/api/register`, {
  method: 'OPTIONS',
  headers: { Origin: mobileWeb, 'Access-Control-Request-Method': 'POST' },
});
assert.equal(r.status, 204);
assert.equal(r.headers.get('access-control-allow-origin'), mobileWeb);
console.log('PASS Expo Web registration CORS');
r = await fetch(`${api}/api`, {
  method: 'OPTIONS',
  headers: { Origin: mobileWeb },
});
assert.equal(r.status, 204);
assert.equal(r.headers.get('access-control-allow-origin'), mobileWeb);
console.log('PASS Expo Web local API CORS');
console.log(`Android project: exp://${host}:8081`);
