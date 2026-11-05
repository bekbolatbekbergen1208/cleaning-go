import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { lockDatabase } from './lock.mjs';

export async function openDatabase(
  path = process.env.LOCAL_DATA_DIR || './.local-data/db',
) {
  if (path !== ':memory:') await mkdir(resolve(path), { recursive: true });
  const release =
    path === ':memory:' ? async () => {} : await lockDatabase(path);
  const db = new PGlite(path === ':memory:' ? undefined : resolve(path));
  const close = db.close.bind(db);
  let closed = false;
  db.close = async () => {
    if (closed) return;
    closed = true;
    try {
      await close();
    } finally {
      await release();
    }
  };
  await db.exec(
    `create table if not exists public.local_migrations(name text primary key, applied_at timestamptz default now());`,
  );
  const initialized = (
    await db.query("select 1 from local_migrations where name='000-local' ")
  ).rows.length;
  if (!initialized)
    await db.transaction(async (tx) => {
      await tx.exec(`
      create role authenticated; create role anon; create role service_role bypassrls;
      create schema auth; create schema storage; create schema extensions;
      create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile as $$
        select substring(decode(string_agg(replace(gen_random_uuid()::text,'-',''),''),'hex') from 1 for n) from generate_series(1,(n+15)/16)
      $$;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table auth.users(id uuid primary key default gen_random_uuid(),email text unique not null,phone text unique,encrypted_password text not null,raw_user_meta_data jsonb not null default '{}',created_at timestamptz default now());
      create table auth.sessions(token_hash text primary key,user_id uuid not null references auth.users(id) on delete cascade,expires_at timestamptz not null);
      create table auth.recoveries(token_hash text primary key,user_id uuid not null references auth.users(id) on delete cascade,expires_at timestamptz not null);
      create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
      alter table storage.objects enable row level security;
      create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:greatest(array_length(string_to_array(name,'/'),1)-1,0)]$$;
      insert into local_migrations(name) values('000-local');
    `);
    });
  for (const name of (await readdir(new URL('./migrations/', import.meta.url)))
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    if (
      (await db.query('select 1 from local_migrations where name=$1', [name]))
        .rows.length
    )
      continue;
    const sql = await readFile(
      new URL(`./migrations/${name}`, import.meta.url),
      'utf8',
    );
    try {
      await db.transaction(async (tx) => {
        await tx.exec(sql);
        await tx.query('insert into local_migrations(name) values($1)', [name]);
      });
    } catch (error) {
      await db.close();
      throw new Error(`Migration ${name}: ${error.message}`);
    }
  }
  await db.exec(`
    grant usage on schema public,auth,storage to authenticated,anon,service_role;
    grant all on all tables in schema public,storage to authenticated,service_role;
    grant usage,select on all sequences in schema public,storage to authenticated,service_role;
    grant select on public.cleaning_services,public.service_options to anon;
    revoke all on public.local_migrations from authenticated,anon;
  `);
  return db;
}
