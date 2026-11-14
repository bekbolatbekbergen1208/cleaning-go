import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../../packages/local-client/src/index.js';
import { companyOrderFixture, ok } from './helpers/company-order.mjs';

// The client rates the company and every cleaner of the team separately; each
// cleaner gets their own rating, moderation removes the scores again.
test('per-cleaner ratings: company and each team member are rated separately', async () => {
  const f = await companyOrderFixture();
  const url = `http://127.0.0.1:${f.app.port}`;
  try {
    const second = ok(await f.admin.auth.admin.createUser({
      email: 'cleaner2@races.test', password: 'password123', phone: '+77018880004',
      user_metadata: { role: 'cleaner', full_name: 'Second Cleaner', referral_code: 'COM-RACES' },
    })).user;
    ok(await f.admin.from('cleaner_profiles').update({ verification_status: 'approved' }).eq('user_id', second.id));
    const cleaner2 = createClient(url);
    ok(await cleaner2.auth.signInWithPassword({ email: 'cleaner2@races.test', password: 'password123' }));
    ok(await cleaner2.rpc('set_cleaner_workday', { target_active: true, duration_hours: 8 }));

    ok(await f.owner.rpc('propose_company_order_price', {
      target_order_id: f.order.id, target_total_minor: 2000000, target_required_workers: 2, target_cleaner_amount_minor: 1000000,
    }));
    const quoted = ok(await f.client.from('orders').select('quote_version').eq('id', f.order.id).single());
    ok(await f.client.rpc('confirm_company_order_price', { target_order_id: f.order.id, expected_quote_version: quoted.quote_version }));
    ok(await f.cleaner.rpc('claim_company_order', { target_order_id: f.order.id }));
    ok(await cleaner2.rpc('claim_company_order', { target_order_id: f.order.id }));

    for (const status of ['accepted', 'on_the_way', 'arrived'])
      ok(await f.cleaner.rpc('advance_company_order', { target_order_id: f.order.id, completion_paths: [], expected_status: status }));
    const photo = `${f.worker.id}/completion-${f.order.id}-1.png`;
    ok(await f.cleaner.storage.from('order-photos').upload(photo, new Blob([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' })));
    ok(await f.cleaner.rpc('advance_company_order', { target_order_id: f.order.id, completion_paths: [photo], expected_status: 'in_progress' }));
    ok(await f.client.rpc('transition_order_status', { target_order_id: f.order.id, next_status: 'completed', note: null }));

    // A cleaner who did not work on the order cannot be rated.
    const outsider = ok(await f.admin.auth.admin.createUser({
      email: 'outsider@races.test', password: 'password123', phone: '+77018880005',
      user_metadata: { role: 'cleaner', full_name: 'Outsider', referral_code: 'COM-RACES' },
    })).user;
    const refused = await f.client.rpc('create_order_review', {
      target_order_id: f.order.id, target_company_rating: 4, target_cleaner_ratings: { [outsider.id]: 1 }, target_text: null,
    });
    assert.ok(refused.error, 'rating an outsider must be refused');
    assert.ok(!(await f.client.from('cleaner_ratings').insert({ order_id: f.order.id, cleaner_id: f.worker.id, client_id: f.customer.id, rating: 1 })).data);

    ok(await f.client.rpc('create_order_review', {
      target_order_id: f.order.id, target_company_rating: 4,
      target_cleaner_ratings: { [f.worker.id]: 5, [second.id]: 2 }, target_text: 'Хорошо',
    }));
    const profiles = async () => {
      const [company, workers] = await Promise.all([
        f.admin.from('company_profiles').select('rating,reviews_count').eq('id', f.company.id).single(),
        f.admin.from('cleaner_profiles').select('user_id,rating,reviews_count').in('user_id', [f.worker.id, second.id]),
      ]);
      const by = (id) => ok(workers).find((w) => w.user_id === id);
      return { company: ok(company), first: by(f.worker.id), second: by(second.id) };
    };
    let now = await profiles();
    assert.equal(Number(now.company.rating), 4);
    assert.equal(Number(now.first.rating), 5, 'first cleaner keeps their own 5');
    assert.equal(Number(now.second.rating), 2, 'second cleaner keeps their own 2');
    assert.equal(now.first.reviews_count, 1);

    // Repeating the review is idempotent and cannot change the scores.
    ok(await f.client.rpc('create_order_review', {
      target_order_id: f.order.id, target_company_rating: 1, target_cleaner_ratings: { [f.worker.id]: 1 }, target_text: null,
    }));
    now = await profiles();
    assert.equal(Number(now.first.rating), 5);

    // Moderation hides the review: every rating built on it disappears.
    ok(await f.admin.from('reviews').update({ is_visible: false }).eq('order_id', f.order.id));
    now = await profiles();
    assert.equal(now.company.reviews_count, 0);
    assert.equal(now.first.reviews_count, 0);
    assert.equal(now.second.reviews_count, 0);
  } finally {
    await f.close();
  }
});
