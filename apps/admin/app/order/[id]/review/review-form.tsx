'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { publishReview } from './actions';

export function ReviewForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    const result = await publishReview(orderId, rating, text);
    if (result.error) {
      setError(result.error);
      submitting.current = false;
      setBusy(false);
      return;
    }
    router.replace('/profile');
    router.refresh();
  }

  return <form className="card mt-6 space-y-5" onSubmit={submit}>
    <div><p className="text-sm font-semibold">Оценка клинеру и компании</p><p className="mt-1 text-xs text-slate-500">Оценка попадёт в средний рейтинг клинера и выполнившей заказ компании.</p><div className="mt-3 grid grid-cols-5 gap-2">{[1, 2, 3, 4, 5].map((value) => <button className={rating === value ? 'button' : 'rounded-xl border border-slate-200 px-3 py-3 font-black'} key={value} onClick={() => setRating(value)} type="button">{value} ★</button>)}</div></div>
    <label className="block"><span className="text-sm font-semibold">Комментарий</span><textarea className="input mt-1" rows={4} value={text} onChange={(event) => setText(event.target.value)} placeholder="Расскажите о качестве уборки" /></label>
    {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
    <button className="button w-full" disabled={busy}>{busy ? 'Публикуем…' : 'Опубликовать отзыв'}</button>
  </form>;
}
