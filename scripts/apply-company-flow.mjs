import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const value = line.trim();
  if (!value || value.startsWith('#')) continue;
  const separator = value.indexOf('=');
  if (separator > 0) env[value.slice(0, separator).trim()] = value.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
}

if (!env.SUPABASE_URL) throw new Error('SUPABASE_URL не заполнен.');
const projectRef = new URL(env.SUPABASE_URL).hostname.split('.')[0];
const password = execFileSync(
  'osascript',
  [
    '-e',
    'display dialog "Введите пароль базы Supabase для добавления выбора компаний и автоотчётов" default answer "" with hidden answer buttons {"Отмена", "Продолжить"} default button "Продолжить"',
    '-e',
    'text returned of result',
  ],
  { encoding: 'utf8' },
).trim();
if (!password) throw new Error('Пароль базы не введён.');

const connection = `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`;
const sql = postgres(connection, { ssl: 'require', max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  await sql.unsafe(readFileSync('supabase/migrations/202608010006_company_clients_reports.sql', 'utf8'));
  const functions = await sql`
    select count(*)::int as count from pg_proc
    where pronamespace='public'::regnamespace and proname in ('choose_company','get_my_company_report')
  `;
  if (functions[0]?.count !== 2) throw new Error('Новые функции не найдены после миграции.');
  console.log('COMPANY_CLIENT_FLOW=READY');
  console.log('COMPANY_REPORTS=READY');
} finally {
  await sql.end({ timeout: 5 });
}
