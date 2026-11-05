import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
await mkdir(resolve(root, '.local-data'), { recursive: true });
const configPath = resolve(root, '.env.local');
let config;
try {
  config = await readFile(configPath, 'utf8');
} catch {
  config = `LOCAL_SERVICE_KEY=${randomBytes(32).toString('hex')}\nLOCAL_API_URL=http://127.0.0.1:54321\nPUBLIC_APP_URL=http://localhost:3000\n`;
  await writeFile(configPath, config, { mode: 0o600 });
}
if (!/^SEED_ADMIN_EMAIL=/m.test(config))
  config += `SEED_ADMIN_EMAIL=admin@cleaning.local\n`;
if (!/^SEED_ADMIN_PASSWORD=/m.test(config))
  config += `SEED_ADMIN_PASSWORD=${randomBytes(18).toString('base64url')}\n`;
await writeFile(configPath, config, { mode: 0o600 });
const email = /^SEED_ADMIN_EMAIL=(.+)$/m.exec(config)?.[1];
const key = /^LOCAL_SERVICE_KEY=(.+)$/m.exec(config)?.[1];
if (!key) throw new Error('LOCAL_SERVICE_KEY missing in .env.local');
const appPath = resolve(root, 'apps/admin/.env.local');
let app = '';
try {
  app = await readFile(appPath, 'utf8');
} catch {}
app = app
  .split('\n')
  .filter(
    (l) =>
      !/^\s*(?:NEXT_PUBLIC_SUPABASE_|SUPABASE_|LOCAL_API_URL=|LOCAL_SERVICE_KEY=|NEXT_PUBLIC_LOCAL_API_URL=|SEED_ADMIN_EMAIL=)/.test(
        l,
      ),
  )
  .join('\n')
  .trim();
await writeFile(
  appPath,
  `${app}\nLOCAL_API_URL=http://127.0.0.1:54321\nNEXT_PUBLIC_LOCAL_API_URL=http://127.0.0.1:54321\nLOCAL_SERVICE_KEY=${key}\nSEED_ADMIN_EMAIL=${email}\n`,
  { mode: 0o600 },
);
const mobilePath = resolve(root, 'apps/mobile/.env.local');
let mobile = '';
try {
  mobile = await readFile(mobilePath, 'utf8');
} catch {}
mobile = mobile
  .split('\n')
  .filter(
    (l) => !/^\s*(?:EXPO_PUBLIC_SUPABASE_|EXPO_PUBLIC_LOCAL_API_URL=)/.test(l),
  )
  .join('\n')
  .trim();
if (!/^EXPO_PUBLIC_DEMO_MODE=/m.test(mobile))
  mobile += '\nEXPO_PUBLIC_DEMO_MODE=false';
await writeFile(
  mobilePath,
  `${mobile}\nEXPO_PUBLIC_LOCAL_API_URL=http://127.0.0.1:54321\n`,
  { mode: 0o600 },
);
console.log(
  'Local configuration ready. Start API: node --env-file=.env.local local/server.mjs',
);
