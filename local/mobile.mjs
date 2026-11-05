import { networkInterfaces } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const candidates = Object.entries(networkInterfaces()).flatMap(
  ([name, entries]) =>
    entries
      .filter(
        (i) =>
          i.family === 'IPv4' &&
          !i.internal &&
          /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address),
      )
      .map((i) => ({ name, address: i.address })),
);
const host =
  process.env.LOCAL_MOBILE_HOST ||
  candidates.find((i) => /^en\d|^wlan|^eth/.test(i.name))?.address ||
  candidates[0]?.address;
if (!host)
  throw new Error(
    'Connect the computer to Wi-Fi or set LOCAL_MOBILE_HOST to its LAN IP.',
  );
if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host))
  throw new Error('LOCAL_MOBILE_HOST must be an IPv4 address');
async function update(file, values) {
  let text = '';
  try {
    text = await readFile(resolve(root, file), 'utf8');
  } catch {}
  const keys = new Set(Object.keys(values));
  text = text
    .split('\n')
    .filter((l) => !keys.has(l.split('=')[0].trim()))
    .join('\n')
    .trim();
  await writeFile(
    resolve(root, file),
    `${text}\n${Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')}\n`,
    { mode: 0o600 },
  );
}
const api = `http://${host}:54321`,
  web = `http://${host}:3000`;
const origins = [
  `http://localhost:3000`,
  `http://127.0.0.1:3000`,
  `http://localhost:8081`,
  `http://127.0.0.1:8081`,
  web,
  `http://${host}:8081`,
];
await update('apps/mobile/.env.local', {
  EXPO_PUBLIC_LOCAL_API_URL: api,
  EXPO_PUBLIC_REGISTRATION_API_URL: `${web}/api/register`,
  EXPO_PUBLIC_DEMO_MODE: 'false',
});
await update('apps/admin/.env.local', {
  NEXT_PUBLIC_LOCAL_API_URL: api,
  LOCAL_ALLOWED_ORIGINS: origins.join(','),
  PUBLIC_APP_URL: web,
});
await update('.env.local', {
  LOCAL_API_HOST: '0.0.0.0',
  LOCAL_PUBLIC_API_URL: api,
  PUBLIC_APP_URL: web,
  LOCAL_ALLOWED_ORIGINS: origins.join(','),
});
const easPath = resolve(root, 'apps/mobile/eas.json');
const eas = JSON.parse(await readFile(easPath, 'utf8'));
eas.build.preview.env = {
  ...eas.build.preview.env,
  EXPO_PUBLIC_LOCAL_API_URL: api,
  EXPO_PUBLIC_REGISTRATION_API_URL: `${web}/api/register`,
};
await writeFile(easPath, JSON.stringify(eas, null, 2) + '\n');
console.log(
  `Android local server: ${api}\nPhone browser: ${web}\nConnect phone and computer to the same Wi-Fi.`,
);
if (!process.argv.includes('--prepare')) {
  const children = [];
  function run(args) {
    const child = spawn('corepack', ['pnpm', ...args], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        LOCAL_API_HOST: '0.0.0.0',
        LOCAL_PUBLIC_API_URL: api,
        PUBLIC_APP_URL: web,
        LOCAL_ALLOWED_ORIGINS: origins.join(','),
        EXPO_PUBLIC_LOCAL_API_URL: api,
        EXPO_PUBLIC_REGISTRATION_API_URL: `${web}/api/register`,
      },
    });
    children.push(child);
    child.on('exit', (code) => {
      if (code && !stopping) {
        console.error(`Process exited with code ${code}`);
        stop(code);
      }
    });
  }
  let stopping = false;
  function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
    process.exitCode = code;
  }
  process.on('SIGINT', () => stop());
  process.on('SIGTERM', () => stop());
  run(['dev:api']);
  run(['--filter', '@cleaning-go/admin', 'dev', '--hostname', '0.0.0.0']);
  run(['--filter', '@cleaning-go/mobile', 'start', '--lan']);
}
