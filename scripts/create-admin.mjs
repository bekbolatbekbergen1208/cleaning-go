import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

function loadEnvFile(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const value = line.trim();
      if (!value || value.startsWith('#')) continue;
      const separator = value.indexOf('=');
      if (separator < 1) continue;
      const key = value.slice(0, separator).trim();
      const raw = value.slice(separator + 1).trim();
      if (!process.env[key]) process.env[key] = raw.replace(/^['"]|['"]$/g, '');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

loadEnvFile('.env');
loadEnvFile('apps/admin/.env.local');

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;

if (!url || !serviceRole || !email || !password) {
  console.error(
    'Заполните SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SEED_ADMIN_EMAIL и SEED_ADMIN_PASSWORD в .env.',
  );
  process.exit(1);
}
if (password.length < 12 || password === 'change-me-locally') {
  console.error('Пароль администратора должен содержать минимум 12 символов и не быть шаблонным.');
  process.exit(1);
}

const supabase = createClient(url, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: listed, error: listError } = await supabase.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});
if (listError) throw listError;

let user = listed.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
if (!user) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Администратор Cleaning Go', role: 'client' },
  });
  if (error) throw error;
  user = data.user;
} else {
  const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
  });
  if (error) throw error;
  user = data.user;
}

const { error: profileError } = await supabase
  .from('profiles')
  .update({ role: 'admin', status: 'active' })
  .eq('id', user.id);
if (profileError) throw profileError;

const { data: profile, error: verifyError } = await supabase
  .from('profiles')
  .select('id,email,role,status')
  .eq('id', user.id)
  .single();
if (verifyError) throw verifyError;
if (profile.role !== 'admin') throw new Error('Роль администратора не была сохранена.');

console.log(`Администратор создан: ${profile.email ?? email} (${profile.id})`);
