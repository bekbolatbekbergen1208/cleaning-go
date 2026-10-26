'use client';

import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';

export function CashbackSettings({ initialBps }: { initialBps: number }) {
  const [bps, setBps] = useState(initialBps);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(targetBps: number) {
    setBusy(true);
    setMessage('');
    const { data, error } = await createClient().rpc('set_my_company_cashback', { target_bps: targetBps });
    setBusy(false);
    if (error) setMessage(error.message);
    else {
      setBps(Number(data));
      setMessage('Процент кешбэка сохранён.');
    }
  }
  return <section className="card mt-5">
    <h2 className="text-xl font-black">Кешбэк клиентам</h2>
    <p className="mt-2 text-sm text-slate-500">Текущий процент: {bps / 100}%. Выберите новый процент для следующих завершённых заказов.</p>
    <div className="mt-4 flex flex-wrap gap-2">{[300, 500, 1000].map(value => <button key={value} type="button" disabled={busy} aria-pressed={bps === value} className={bps === value ? 'button' : 'rounded-xl border border-slate-300 px-4 py-3 font-bold'} onClick={() => void save(value)}>{value / 100}%</button>)}</div>
    {message && <p role="status" className="mt-3 text-sm font-semibold text-emerald-700">{message}</p>}
  </section>;
}
