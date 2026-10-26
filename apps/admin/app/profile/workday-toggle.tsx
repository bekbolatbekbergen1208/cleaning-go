'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';

export function WorkdayToggle({ active }: { active: boolean }) {
  const router = useRouter();
  const [working, setWorking] = useState(active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function toggle() {
    setBusy(true);
    setError('');
    const { error: updateError } = await createClient().rpc('set_cleaner_workday', { target_active: !working });
    setBusy(false);
    if (updateError) setError(updateError.message);
    else {
      setWorking(!working);
      router.refresh();
    }
  }
  return <section className="mt-6 rounded-2xl bg-sky-50 p-4">
    <h2 className="font-black">Рабочий день</h2>
    <p className="mt-1 text-sm text-slate-600">{working ? 'Вы доступны для заказов. GPS передаётся только для активного заказа, когда вы включили его на карте.' : 'Рабочий день завершён. Геолокация отключена, текущие точки удалены.'}</p>
    <button className="button mt-3" type="button" disabled={busy} onClick={() => void toggle()}>{busy ? 'Сохраняем…' : working ? 'Завершить рабочий день' : 'Начать рабочий день'}</button>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </section>;
}
