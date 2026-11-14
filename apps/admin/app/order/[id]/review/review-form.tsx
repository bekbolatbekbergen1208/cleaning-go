'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { publishReview } from './actions';

function Stars({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold">{label}</legend>
      <div className="rating-picker mt-2 grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            aria-label={`${label}: ${n} из 5`}
            aria-pressed={value === n}
            className={value === n ? 'button' : 'rounded-xl border border-slate-200 px-3 py-3 font-black'}
            key={n}
            onClick={() => onChange(n)}
            type="button"
          >
            {n} ★
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function ReviewForm({
  orderId,
  company,
  cleaners,
}: {
  orderId: string;
  company: { name: string } | null;
  cleaners: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [companyRating, setCompanyRating] = useState(5);
  const [cleanerRatings, setCleanerRatings] = useState<Record<string, number>>(() =>
    Object.fromEntries(cleaners.map((c) => [c.id, 5])),
  );
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (!company && !cleaners.length) {
      setError('Не удалось определить исполнителя заказа. Обновите страницу.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError('');
    const result = await publishReview(orderId, company ? companyRating : null, cleanerRatings, text);
    if (result.error) {
      setError(result.error);
      submitting.current = false;
      setBusy(false);
      return;
    }
    router.replace('/profile');
    router.refresh();
  }

  return (
    <form className="card mt-6 space-y-6" onSubmit={submit}>
      {company && <Stars label={`Компания «${company.name}»`} value={companyRating} onChange={setCompanyRating} />}
      {cleaners.length > 0 && (
        <div className="space-y-5">
          {company && (
            <p className="text-sm text-slate-500">
              {cleaners.length > 1 ? 'Оцените каждого клинера отдельно — у каждого свой рейтинг.' : 'Оцените клинера, который проводил уборку.'}
            </p>
          )}
          {cleaners.map((cleaner) => (
            <Stars
              key={cleaner.id}
              label={`Клинер ${cleaner.name}`}
              value={cleanerRatings[cleaner.id] ?? 5}
              onChange={(value) => setCleanerRatings((current) => ({ ...current, [cleaner.id]: value }))}
            />
          ))}
        </div>
      )}
      <label className="block">
        <span className="text-sm font-semibold">Комментарий</span>
        <textarea
          className="input mt-1"
          rows={4}
          maxLength={2000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Расскажите о качестве уборки"
        />
      </label>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button className="button w-full" disabled={busy}>
        {busy ? 'Публикуем…' : 'Опубликовать отзыв'}
      </button>
    </form>
  );
}
