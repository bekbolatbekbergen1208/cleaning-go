import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const separator = trimmed.indexOf('=');
  if (separator < 1) continue;
  process.env[trimmed.slice(0, separator).trim()] = trimmed
    .slice(separator + 1)
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) throw new Error('SUPABASE_URL или серверный ключ не заполнен.');

const supabase = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error: authError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
if (authError) throw new Error(`Supabase Auth: ${authError.message}`);
console.log('SERVER_ACCESS=OK');

const { error: tableError } = await supabase.from('profiles').select('id').limit(1);
if (tableError) {
  console.log(`SCHEMA_STATUS=MISSING`);
  console.log(`SCHEMA_MESSAGE=${tableError.message}`);
} else {
  console.log('SCHEMA_STATUS=READY');
}

if (process.env.SEED_ADMIN_EMAIL && process.env.SEED_ADMIN_PASSWORD && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
  const publicClient = createClient(url, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: login, error: loginError } = await publicClient.auth.signInWithPassword({
    email: process.env.SEED_ADMIN_EMAIL,
    password: process.env.SEED_ADMIN_PASSWORD,
  });
  if (loginError) throw new Error(`Admin login: ${loginError.message}`);
  const { data: profile, error: profileError } = await publicClient
    .from('profiles').select('role,status').eq('id', login.user.id).single();
  if (profileError) throw new Error(`Admin profile: ${profileError.message}`);
  if (profile.role !== 'admin' || profile.status !== 'active') throw new Error('Admin role/status invalid.');
  await publicClient.auth.signOut();
  console.log('ADMIN_LOGIN=OK');
}
