import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('GPS: separate cleaners, assignment checks, read boundaries and terminal cleanup', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create role authenticated;
      grant usage on schema public,auth to authenticated;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create table profiles(id uuid primary key,role text,status text);
      create table orders(id uuid primary key,status text,client_id uuid,company_owner uuid);
      create table order_workers(order_id uuid,cleaner_id uuid);
      create table order_assignments(order_id uuid,cleaner_id uuid,is_active boolean);
      create table cleaner_locations(id uuid default gen_random_uuid(), order_id uuid not null unique references orders(id),cleaner_id uuid,latitude numeric,longitude numeric,heading numeric,speed numeric,recorded_at timestamptz);
      alter table cleaner_locations enable row level security;
      create function is_order_participant(target_order_id uuid) returns boolean language sql security definer as $$
        select exists(select 1 from orders where id=target_order_id and (client_id=auth.uid() or company_owner=auth.uid()))
          or exists(select 1 from order_workers where order_id=target_order_id and cleaner_id=auth.uid())
      $$;
      grant select on profiles,orders,cleaner_locations to authenticated;
      insert into profiles values('${id(1)}','cleaner','active'),('${id(2)}','cleaner','active'),('${id(3)}','client','active'),('${id(4)}','company_owner','active'),('${id(5)}','cleaner','active'),('${id(6)}','cleaner','blocked');
      insert into orders values('${id(10)}','accepted','${id(3)}','${id(4)}');
      insert into order_workers values('${id(10)}','${id(1)}'),('${id(10)}','${id(2)}'),('${id(10)}','${id(6)}');
    `);
    const migration = readFileSync('supabase/migrations/202610080029_multi_cleaner_live_tracking.sql', 'utf8');
    await db.exec(migration);
    await db.exec(migration); // Safe if SQL Editor runs it again.
    async function gps(user, lat = 51.128, lng = 71.43) {
      await db.exec(`set test.uid='${id(user)}'`);
      return db.query('select update_cleaner_location($1,$2,$3)', [id(10), lat, lng]);
    }
    await gps(1); await gps(2); await gps(1, 51.13);
    assert.equal((await db.query('select * from cleaner_locations')).rows.length, 2);
    assert.equal(Number((await db.query('select latitude from cleaner_locations where cleaner_id=$1', [id(1)])).rows[0].latitude), 51.13);
    await assert.rejects(gps(5), /Location sharing is inactive/);
    await assert.rejects(gps(6), /Location sharing is inactive/);
    await assert.rejects(gps(1, null), /Invalid coordinates/);
    await assert.rejects(gps(1, 91), /Invalid coordinates/);
    for (const [user, count] of [[3, 2], [4, 2], [5, 0], [6, 0]]) {
      await db.exec(`set test.uid='${id(user)}'; set role authenticated`);
      assert.equal((await db.query('select * from cleaner_locations')).rows.length, count);
      await db.exec('reset role');
    }
    await db.exec(`update orders set status='completed_by_cleaner' where id='${id(10)}'`);
    assert.equal((await db.query('select * from cleaner_locations')).rows.length, 0);
    await assert.rejects(gps(1), /Location sharing is inactive/);
    await db.exec(`update orders set status='on_the_way' where id='${id(10)}'`);
    await gps(2);
    await db.exec(`update orders set status='cancelled' where id='${id(10)}'`);
    assert.equal((await db.query('select * from cleaner_locations')).rows.length, 0);
  } finally { await db.close(); }
});
