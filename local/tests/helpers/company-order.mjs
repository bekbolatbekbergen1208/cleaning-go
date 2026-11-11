import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../../server.mjs';
import { createClient } from '../../../packages/local-client/src/index.js';
export const ok = (r) => {
  assert.equal(r.error, null, JSON.stringify(r));
  return r.data;
};
export async function companyOrderFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'cleaning-order-races-'));
  const key = 'order-races-test-service-key-'.repeat(3);
  const app = await startServer({ port: 0, dataDir: dir, serviceKey: key });
  const url = `http://127.0.0.1:${app.port}`;
  const admin = createClient(url, key),
    client = createClient(url),
    owner = createClient(url),
    cleaner = createClient(url);
  const close = async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  };
  try {
    const companyUser = ok(
      await admin.auth.admin.createUser({
        email: 'owner@races.test',
        password: 'password123',
        phone: '+77018880001',
        user_metadata: {
          role: 'company_owner',
          full_name: 'Race Company',
          company_name: 'Race Company',
          company_registration_number: '444456789012',
          company_city: 'Актау',
          company_address: 'Office',
          company_phone: '+77018880001',
        },
      }),
    ).user;
    const company = ok(
      await admin
        .from('company_profiles')
        .select('*')
        .eq('owner_id', companyUser.id)
        .single(),
    );
    ok(
      await admin
        .from('company_profiles')
        .update({ verification_status: 'approved' })
        .eq('id', company.id),
    );
    const community = ok(
      await admin
        .from('cleaner_communities')
        .insert({
          name: 'Race Community',
          code: 'COM-RACES',
          created_by: companyUser.id,
        })
        .select('*')
        .single(),
    );
    const worker = ok(
      await admin.auth.admin.createUser({
        email: 'cleaner@races.test',
        password: 'password123',
        phone: '+77018880002',
        user_metadata: {
          role: 'cleaner',
          full_name: 'Race Cleaner',
          referral_code: community.code,
        },
      }),
    ).user;
    const customer = ok(
      await admin.auth.admin.createUser({
        email: 'client@races.test',
        password: 'password123',
        phone: '+77018880003',
        user_metadata: { role: 'client', full_name: 'Race Client' },
      }),
    ).user;
    ok(
      await admin
        .from('cleaner_profiles')
        .update({ verification_status: 'approved' })
        .eq('user_id', worker.id),
    );
    for (const [api, email] of [
      [owner, companyUser.email],
      [cleaner, worker.email],
      [client, customer.email],
    ])
      ok(await api.auth.signInWithPassword({ email, password: 'password123' }));
    ok(
      await owner.rpc('join_company_community', {
        community_code: community.code,
      }),
    );
    ok(
      await cleaner.rpc('set_cleaner_workday', {
        target_active: true,
        duration_hours: 8,
      }),
    );
    const photo = `${customer.id}/room.png`;
    ok(
      await client.storage
        .from('order-photos')
        .upload(
          photo,
          new Blob([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])], {
            type: 'image/png',
          }),
        ),
    );
    const address = ok(
      await client
        .from('addresses')
        .insert({
          user_id: customer.id,
          city: 'Актау',
          address_line: 'Race Test Address',
        })
        .select('*')
        .single(),
    );
    const order = ok(
      await client.rpc('create_order', {
        payload: {
          service_id: '10000000-0000-0000-0000-000000000001',
          address_id: address.id,
          selected_company_id: company.id,
          scheduled_at: new Date(Date.now() + 86400000).toISOString(),
          area_sq_m: 50,
          rooms_count: 2,
          photo_urls: [photo],
          payment_method: 'cash',
        },
      }),
    );
    const quote = (amount = 1000000) =>
      owner.rpc('propose_company_order_price', {
        target_order_id: order.id,
        target_total_minor: amount,
        target_required_workers: 1,
        target_cleaner_amount_minor: 500000,
      });
    return {
      app,
      admin,
      client,
      owner,
      cleaner,
      customer,
      worker,
      company,
      order,
      quote,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
