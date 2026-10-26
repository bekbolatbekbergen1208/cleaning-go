'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';

export function WorkdayToggle({ active, endsAt }: { active: boolean; endsAt: string | null }) {
  const router = useRouter();
  const [working, setWorking] = useState(active);
  const [deadline, setDeadline] = useState(endsAt);
  const [hours, setHours] = useState(8);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const onShift = working && Boolean(deadline && Date.parse(deadline) > now);
  async function toggle() {
    setBusy(true);
    setError('');
    const { error: updateError } = await createClient().rpc('set_cleaner_workday', {
      target_active: !onShift,
      duration_hours: hours,
    });
    setBusy(false);
    if (updateError) setError(updateError.message);
    else {
      setWorking(!onShift);
      setDeadline(onShift ? null : new Date(Date.now() + hours * 3_600_000).toISOString());
      router.refresh();
    }
  }
  return <section className="mt-6 rounded-2xl bg-sky-50 p-4">
    <h2 className="font-black">Рабочий день</h2>
    <p className="mt-1 text-sm text-slate-600">{onShift
      ? `Вы доступны до ${new Date(deadline!).toLocaleString('ru-KZ')}. После этого времени передача GPS остановится автоматически.`
      : 'Рабочий день завершён. Новые GPS точки недоступны клиенту и компании.'}</p>
    {!onShift && <label className="mt-3 block text-sm font-semibold">Длительность смены
      <select className="input mt-1" value={hours} onChange={event => setHours(Number(event.target.value))}>
        {[4, 6, 8, 10, 12].map(value => <option key={value} value={value}>{value} ч</option>)}
      </select>
    </label>}
    <button className="button mt-3" type="button" disabled={busy} onClick={() => void toggle()}>{busy ? 'Сохраняем…' : onShift ? 'Завершить рабочий день' : 'Начать рабочий день'}</button>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </section>;
}
