import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyOrderFixture, ok } from './helpers/company-order.mjs';

test('stale quotes require renewed consent; duplicate step retries and photo reports have one effect', async () => {
  const f = await companyOrderFixture();
  try {
    const shown = ok(await f.quote(1000000));
    const revised = ok(await f.quote(1200000));
    assert.equal(
      Number(revised.quote_version),
      Number(shown.quote_version) + 1,
    );
    assert.ok(
      (
        await f.client.rpc('confirm_company_order_price', {
          target_order_id: f.order.id,
          expected_quote_version: shown.quote_version,
        })
      ).error,
    );
    assert.ok(
      (
        await f.client.rpc('confirm_company_order_price', {
          target_order_id: f.order.id,
        })
      ).error,
      'old forms must refresh',
    );
    assert.equal(
      ok(
        await f.admin
          .from('orders')
          .select('status')
          .eq('id', f.order.id)
          .single(),
      ).status,
      'offered',
    );
    const consent = {
      target_order_id: f.order.id,
      expected_quote_version: revised.quote_version,
    };
    const confirmations = await Promise.all([
      f.client.rpc('confirm_company_order_price', consent),
      f.client.rpc('confirm_company_order_price', consent),
    ]);
    for (const r of confirmations) assert.equal(ok(r).status, 'accepted');
    assert.equal(
      ok(
        await f.admin
          .from('order_assignments')
          .select('id')
          .eq('order_id', f.order.id),
      ).length,
      1,
    );
    assert.ok(
      (
        await f.client.rpc('confirm_company_order_price_unchecked', {
          target_order_id: f.order.id,
        })
      ).error,
    );
    ok(
      await f.cleaner.rpc('claim_company_order', {
        target_order_id: f.order.id,
      }),
    );
    const step = { target_order_id: f.order.id, expected_status: 'accepted' };
    for (const r of await Promise.all([
      f.cleaner.rpc('advance_company_order', step),
      f.cleaner.rpc('advance_company_order', step),
    ]))
      assert.equal(ok(r).status, 'on_the_way');
    assert.equal(
      ok(
        await f.admin
          .from('order_status_history')
          .select('id')
          .eq('order_id', f.order.id)
          .eq('to_status', 'on_the_way'),
      ).length,
      1,
    );
    assert.ok(
      (
        await f.cleaner.rpc('advance_company_order', {
          target_order_id: f.order.id,
        })
      ).error,
      'missing expected stage must not advance',
    );
    assert.equal(
      ok(
        await f.cleaner.rpc('advance_company_order', {
          target_order_id: f.order.id,
          expected_status: 'on_the_way',
        }),
      ).status,
      'arrived',
    );
    assert.ok(
      (await f.cleaner.rpc('advance_company_order', step)).error,
      'an older retry cannot skip a newer step',
    );
    assert.equal(
      ok(
        await f.cleaner.rpc('advance_company_order', {
          target_order_id: f.order.id,
          expected_status: 'arrived',
        }),
      ).status,
      'in_progress',
    );
    const path = `${f.worker.id}/completion-${f.order.id}-report.png`;
    ok(
      await f.cleaner.storage
        .from('order-photos')
        .upload(
          path,
          new Blob([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])], {
            type: 'image/png',
          }),
        ),
    );
    const finish = {
      target_order_id: f.order.id,
      expected_status: 'in_progress',
      completion_paths: [path],
    };
    for (const r of await Promise.all([
      f.cleaner.rpc('advance_company_order', finish),
      f.cleaner.rpc('advance_company_order', finish),
    ]))
      assert.equal(ok(r).status, 'completed_by_cleaner');
    const photos = ok(
      await f.admin
        .from('orders')
        .select('photo_urls')
        .eq('id', f.order.id)
        .single(),
    ).photo_urls;
    assert.equal(
      photos.filter((p) => p === path).length,
      1,
      'photo report must not be duplicated',
    );
    assert.equal(
      ok(
        await f.admin
          .from('order_status_history')
          .select('id')
          .eq('order_id', f.order.id)
          .eq('to_status', 'completed_by_cleaner'),
      ).length,
      1,
    );
    ok(
      await f.client.rpc('transition_order_status', {
        target_order_id: f.order.id,
        next_status: 'completed',
      }),
    );
    assert.ok(
      (
        await f.client.rpc('create_review', {
          target_order_id: f.order.id,
          target_rating: 5,
          target_text: 'x'.repeat(2001),
        })
      ).error,
    );
    assert.ok(
      (
        await f.client.rpc('create_review', {
          target_order_id: f.order.id,
          target_rating: 5,
          target_tags: Array(11).fill('tag'),
        })
      ).error,
    );
    const review = ok(
      await f.client.rpc('create_review', {
        target_order_id: f.order.id,
        target_rating: 5,
        target_text: 'Valid review',
      }),
    );
    assert.ok(review.id);
    assert.equal(
      ok(await f.admin.from('reviews').select('id').eq('order_id', f.order.id))
        .length,
      1,
    );
    // Simulate a review written before the input limit existed; moderation must
    // still work without truncating the historical text.
    await f.app.db.exec('alter table public.reviews disable trigger validate_review_input');
    ok(await f.admin.from('reviews').update({ text: 'historic'.repeat(400) }).eq('id',review.id));
    await f.app.db.exec('alter table public.reviews enable trigger validate_review_input');
    ok(await f.admin.from('reviews').update({ is_visible: false }).eq('id',review.id));
    assert.equal(ok(await f.admin.from('reviews').select('is_visible').eq('id',review.id).single()).is_visible,false);

  } finally {
    await f.close();
  }
});
