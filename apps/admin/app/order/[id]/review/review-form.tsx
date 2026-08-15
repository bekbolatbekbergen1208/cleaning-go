'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '../../../../lib/supabase/client';

export function ReviewForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const { error: reviewError } = await createClient().rpc('create_review', {
      target_order_id: orderId,
      target_rating: rating,
      target_text: text.trim() || null,
      target_tags: [],
    });
    if (reviewError) { setError(reviewError.message); setBusy(false); return; }
    router.replace('/profile');
    router.refresh();
  }

  return <form className="card mt-6 space-y-5" onSubmit={submit}>
    <div><p className="text-sm font-semibold">Оценка</p><div className="mt-3 grid grid-cols-5 gap-2">{[1, 2, 3, 4, 5].map((value) => <button className={rating === value ? 'button' : 'rounded-xl border border-slate-200 px-3 py-3 font-black'} key={value} onClick={() => setRating(value)} type="button">{value} ★</button>)}</div></div>
    <label className="block"><span className="text-sm font-semibold">Комментарий</span><textarea className="input mt-1" rows={4} value={text} onChange={(event) => setText(event.target.value)} placeholder="Расскажите о качестве уборки" /></label>
    {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
    <button className="button w-full" disabled={busy}>{busy ? 'Публикуем…' : 'Опубликовать отзыв'}</button>
  </form>;
}
