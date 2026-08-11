import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import postgres from 'postgres';

function readEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    env[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = readEnv();
const projectRef = new URL(env.SUPABASE_URL).hostname.split('.')[0];
if (projectRef !== 'owqymxygcrkovklgefzt') {
  throw new Error(`Неожиданный Supabase project ref: ${projectRef}`);
}

const password = execFileSync(
  'osascript',
  [
    '-e',
    'display dialog "Введите НОВЫЙ пароль базы Supabase для Cleaning Go" default answer "" with hidden answer buttons {"Отмена", "Продолжить"} default button "Продолжить"',
    '-e',
    'text returned of result',
  ],
  { encoding: 'utf8' },
).trim();
if (!password) throw new Error('Пароль базы не введён.');

const regions = [
  'eu-central-1','ap-south-1','eu-west-1','eu-north-1','ap-southeast-1',
  'ap-southeast-2','ap-northeast-1','us-east-1','us-west-1','us-west-2',
  'ca-central-1','sa-east-1',
];
let sql;
for (const region of regions) {
  for (const cluster of ['aws-0','aws-1']) {
    const host = `${cluster}-${region}.pooler.supabase.com`;
    const connection = `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@${host}:5432/postgres`;
    const candidate = postgres(connection, { ssl:'require',max:1,connect_timeout:3,idle_timeout:3,onnotice:()=>{} });
    try {
      await candidate`select 1 as connected`;
      sql = candidate;
      console.log(`POOLER_REGION=${region}`);
      break;
    } catch (error) {
      await candidate.end({ timeout: 1 }).catch(() => {});
      if (error?.code === '28P01') throw new Error('Неверный пароль базы Supabase. Сбросьте пароль и повторите попытку.');
    }
  }
  if (sql) break;
}
if (!sql) throw new Error('Не удалось определить Session Pooler проекта.');

try {
  await sql`select 1 as connected`;
  console.log('DATABASE_CONNECTION=OK');
  const migrations = readdirSync('supabase/migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const migration of migrations) {
    const source = readFileSync(`supabase/migrations/${migration}`, 'utf8');
    await sql.begin(async (transaction) => {
      await transaction.unsafe(source);
    });
    console.log(`APPLIED=${migration}`);
  }
  console.log('MIGRATIONS=COMPLETE');
} finally {
  await sql.end({ timeout: 5 });
}
