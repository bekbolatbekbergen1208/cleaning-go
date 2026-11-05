import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server.mjs';
import { createClient } from '../../packages/local-client/src/index.js';
const ok = (r) => {
  assert.equal(r.error, null, JSON.stringify(r));
  return r.data;
};
test('orders: client → cleaner → GPS → completion → payment → idempotent review; company price guards', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cleaning-orders-'));
  const key = 'integration-secret-'.repeat(4);
  const app = await startServer({ port: 0, dataDir: dir, serviceKey: key });
  const url = `http://127.0.0.1:${app.port}`;
  const admin = createClient(url, key),
    customer = createClient(url),
    cleaner = createClient(url),
    owner = createClient(url);
  try {
    const companyUser = ok(
      await admin.auth.admin.createUser({
        email: 'company@example.test',
        password: 'password123',
        phone: '+77020000001',
        user_metadata: {
          role: 'company_owner',
          full_name: 'Компания тест',
          company_name: 'Тест клининг',
          company_registration_number: '123456789012',
          company_city: 'Актау',
          company_address: 'Дом 1',
          company_phone: '+77020000001',
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
          name: 'Тест сообщество',
          code: 'COM-TEST',
          created_by: companyUser.id,
        })
        .select('*')
        .single(),
    );
    ok(
      await owner.auth.signInWithPassword({
        email: companyUser.email,
        password: 'password123',
      }),
    );
    ok(
      await owner.rpc('join_company_community', {
        community_code: community.code,
      }),
    );
    const cleanerUser = ok(
      await admin.auth.admin.createUser({
        email: 'cleaner@example.test',
        password: 'password123',
        phone: '+77020000002',
        user_metadata: {
          role: 'cleaner',
          full_name: 'Клинер тест',
          referral_code: community.code,
        },
      }),
    ).user;
    const clientUser = ok(
      await admin.auth.admin.createUser({
        email: 'client@example.test',
        password: 'password123',
        phone: '+77020000003',
        user_metadata: { role: 'client', full_name: 'Клиент тест' },
      }),
    ).user;
    ok(
      await admin
        .from('cleaner_profiles')
        .update({
          verification_status: 'approved',
          work_zone: 'Актау',
          is_available: true,
          workday_ends_at: new Date(Date.now() - 1000).toISOString(),
        })
        .eq('user_id', cleanerUser.id),
    );
    ok(
      await customer.auth.signInWithPassword({
        email: clientUser.email,
        password: 'password123',
      }),
    );
    ok(
      await cleaner.auth.signInWithPassword({
        email: cleanerUser.email,
        password: 'password123',
      }),
    );
    ok(
      await owner.auth.signInWithPassword({
        email: companyUser.email,
        password: 'password123',
      }),
    );
    const address = ok(
      await customer
        .from('addresses')
        .insert({
          user_id: clientUser.id,
          city: 'Актау',
          address_line: 'Дом 10',
        })
        .select('*')
        .single(),
    );
    const photo = `${clientUser.id}/room.png`;
    ok(
      await customer.storage
        .from('order-photos')
        .upload(photo, new Blob(['test'], { type: 'image/png' })),
    );
    const payload = {
      service_id: '10000000-0000-0000-0000-000000000001',
      address_id: address.id,
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      area_sq_m: 50,
      rooms_count: 2,
      payment_method: 'cash',
      photo_urls: [photo],
      selected_cleaner_id: cleanerUser.id,
      total_minor: 1,
    };
    const order = ok(await customer.rpc('create_order', { payload }));
    assert.equal(Number(order.total_minor), 800000);
    assert.ok(
      (await cleaner.rpc('accept_order', { target_order_id: order.id })).error,
    );
    assert.equal(
      ok(
        await cleaner.rpc('set_cleaner_workday', {
          target_active: true,
          duration_hours: 8,
        }),
      ),
      true,
    );
    ok(await cleaner.rpc('accept_order', { target_order_id: order.id }));
    assert.ok(
      (
        await customer.rpc('update_cleaner_location', {
          target_order_id: order.id,
          lat: 43.65,
          lng: 51.16,
        })
      ).error,
    );
    ok(
      await cleaner.rpc('update_cleaner_location', {
        target_order_id: order.id,
        lat: 43.65,
        lng: 51.16,
      }),
    );
    assert.equal(
      ok(
        await customer
          .from('cleaner_locations')
          .select('*')
          .eq('order_id', order.id),
      ).length,
      1,
    );
    assert.ok(
      (
        await customer.rpc('transition_order_status', {
          target_order_id: order.id,
          next_status: 'completed',
        })
      ).error,
    );
    for (const status of [
      'on_the_way',
      'arrived',
      'in_progress',
      'completed_by_cleaner',
    ])
      ok(
        await cleaner.rpc('transition_order_status', {
          target_order_id: order.id,
          next_status: status,
        }),
      );
    assert.equal(
      ok(
        await customer
          .from('cleaner_locations')
          .select('*')
          .eq('order_id', order.id),
      ).length,
      0,
    );
    const complete = ok(
      await customer.rpc('transition_order_status', {
        target_order_id: order.id,
        next_status: 'completed',
      }),
    );
    assert.equal(complete.payment_status, 'paid');
    const review = {
      target_order_id: order.id,
      target_rating: 5,
      target_text: 'Отличная уборка',
      target_tags: ['рекомендую'],
    };
    const first = ok(await customer.rpc('create_review', review));
    const second = ok(await customer.rpc('create_review', review));
    assert.equal(first.id, second.id);
    const nested = ok(
      await customer
        .from('orders')
        .select('id,reviews(id),profiles!orders_client_id_fkey(full_name)')
        .eq('id', order.id)
        .single(),
    );
    assert.equal(nested.reviews.length, 1);
    assert.equal(nested.profiles.full_name, 'Клиент тест');
    const companyOrder = ok(
      await customer.rpc('create_order', {
        payload: {
          ...payload,
          selected_cleaner_id: null,
          selected_company_id: company.id,
        },
      }),
    );
    assert.ok(
      (
        await owner.rpc('set_company_order_price', {
          target_order_id: companyOrder.id,
          target_total_minor: 10000,
          target_required_workers: 1,
        })
      ).error,
    );
    const priced = ok(
      await owner.rpc('set_company_order_price', {
        target_order_id: companyOrder.id,
        target_total_minor: 1000000,
        target_required_workers: 2,
      }),
    );
    assert.equal(priced.required_workers, 2);
    assert.ok(Number(priced.executor_amount_minor) > 0);
    assert.equal(priced.status, 'offered');
    assert.equal(priced.price_confirmed_at, null);
    assert.ok(
      (
        await owner.rpc('accept_order', {
          target_order_id: companyOrder.id,
          target_company_id: company.id,
        })
      ).error,
    );
    assert.ok(
      (
        await cleaner.rpc('confirm_company_order_price', {
          target_order_id: companyOrder.id,
        })
      ).error,
    );
    ok(
      await customer.rpc('confirm_company_order_price', {
        target_order_id: companyOrder.id,
      }),
    );
    ok(
      await customer.rpc('confirm_company_order_price', {
        target_order_id: companyOrder.id,
      }),
    );
    ok(
      await cleaner.rpc('claim_company_order', {
        target_order_id: companyOrder.id,
      }),
    );
    ok(
      await cleaner.rpc('claim_company_order', {
        target_order_id: companyOrder.id,
      }),
    );
    assert.equal(
      ok(
        await admin
          .from('order_workers')
          .select('*')
          .eq('order_id', companyOrder.id),
      ).length,
      1,
    );
    assert.ok(
      (
        await customer.rpc('claim_company_order', {
          target_order_id: companyOrder.id,
        })
      ).error,
    );
    const counts = ok(
      await admin
        .from('cleaner_communities')
        .select('id,community_companies(count),community_cleaners(count)')
        .eq('id', community.id)
        .single(),
    );
    assert.equal(counts.community_companies[0].count, 1);
    assert.equal(counts.community_cleaners[0].count, 1);
    for (const next_status of [
      'on_the_way',
      'arrived',
      'in_progress',
      'completed_by_cleaner',
    ])
      ok(
        await cleaner.rpc('transition_order_status', {
          target_order_id: companyOrder.id,
          next_status,
        }),
      );
    const companyDone = ok(
      await customer.rpc('transition_order_status', {
        target_order_id: companyOrder.id,
        next_status: 'completed',
      }),
    );
    assert.ok(Number(companyDone.platform_fee_minor) > 0);
    assert.ok(companyDone.finances_finalized_at);
    assert.equal(
      Number(companyDone.executor_amount_minor),
      Number(priced.executor_amount_minor),
    );
    const cardOrder = ok(
      await customer.rpc('create_order', {
        payload: { ...payload, payment_method: 'card' },
      }),
    );
    ok(await cleaner.rpc('accept_order', { target_order_id: cardOrder.id }));
    for (const next_status of [
      'on_the_way',
      'arrived',
      'in_progress',
      'completed_by_cleaner',
    ])
      ok(
        await cleaner.rpc('transition_order_status', {
          target_order_id: cardOrder.id,
          next_status,
        }),
      );
    const cardDone = ok(
      await customer.rpc('transition_order_status', {
        target_order_id: cardOrder.id,
        next_status: 'completed',
      }),
    );
    assert.equal(cardDone.payment_status, 'pending');
    assert.equal(cardDone.finances_finalized_at, null);
    assert.ok(
      (
        await customer.rpc('create_order', {
          payload: { ...payload, scheduled_at: '2020-01-01T00:00:00Z' },
        })
      ).error,
    );
    assert.ok(
      (
        await customer.rpc('create_order', {
          payload: {
            ...payload,
            photo_urls: [`${companyUser.id}/private.png`],
          },
        })
      ).error,
    );
    const cancelOrder = ok(
      await customer.rpc('create_order', {
        payload: {
          ...payload,
          selected_cleaner_id: null,
          selected_company_id: company.id,
        },
      }),
    );
    ok(
      await owner.rpc('set_company_order_price', {
        target_order_id: cancelOrder.id,
        target_total_minor: 1000000,
        target_required_workers: 1,
      }),
    );
    ok(
      await customer.rpc('transition_order_status', {
        target_order_id: cancelOrder.id,
        next_status: 'cancelled',
      }),
    );
    assert.ok(
      (
        await customer.rpc('open_dispute', {
          target_order_id: cancelOrder.id,
          target_reason: 'test',
          target_description: 'test',
        })
      ).error,
    );
    ok(
      await customer.rpc('open_dispute', {
        target_order_id: companyOrder.id,
        target_reason: 'poor_quality',
        target_description: 'Проверка обращения',
      }),
    );

    ok(
      await customer.rpc('apply_invitation_code', {
        input_code: company.company_code,
      }),
    );
    const balance = ok(
      await customer
        .from('company_bonus_balances')
        .select('balance_minor')
        .eq('client_id', clientUser.id)
        .eq('company_id', company.id)
        .single(),
    );
    assert.ok(
      (
        await customer.rpc('apply_invitation_code', {
          input_code: company.company_code,
        })
      ).error,
    );
    const repeated = ok(
      await customer
        .from('company_bonus_balances')
        .select('balance_minor')
        .eq('client_id', clientUser.id)
        .eq('company_id', company.id)
        .single(),
    );
    assert.equal(
      Number(balance.balance_minor),
      Number(company.welcome_bonus_minor),
    );
    assert.equal(repeated.balance_minor, balance.balance_minor);
    const bonusOrder=ok(await customer.rpc('create_order_with_bonus',{payload:{...payload,selected_cleaner_id:null,selected_company_id:company.id,bonus_amount_minor:100000}}));
    assert.equal(Number(bonusOrder.requested_company_bonus_minor),100000);
    ok(await owner.rpc('set_company_order_price',{target_order_id:bonusOrder.id,target_total_minor:1000000,target_required_workers:1}));
    const bonusConfirmed=ok(await customer.rpc('confirm_company_order_price',{target_order_id:bonusOrder.id}));
    assert.equal(Number(bonusConfirmed.total_minor),900000);
    assert.equal(Number(bonusConfirmed.company_bonus_used_minor),100000);
    ok(await admin.from('orders').update({status:'cancelled'}).eq('id',bonusOrder.id));
    ok(await admin.from('orders').update({status:'cancelled'}).eq('id',bonusOrder.id));
    const restored=ok(await customer.from('company_bonus_balances').select('balance_minor').eq('client_id',clientUser.id).eq('company_id',company.id).single());
    assert.equal(Number(restored.balance_minor),Number(balance.balance_minor));


    assert.equal(
      ok(
        await customer.rpc('preview_invitation_code', {
          input_code: company.company_code,
        }),
      ).company_id,
      company.id,
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
