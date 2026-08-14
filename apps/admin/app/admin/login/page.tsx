'use client';

import { createClient } from '../../../lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    const supabase = createClient();
    const { data, error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (loginError || !data.user) { setError('Неверный email или пароль'); setLoading(false); return; }

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single();
    if (profile?.role !== 'admin') {
      await supabase.auth.signOut();
      setError('У этого аккаунта нет доступа администратора.');
      setLoading(false);
      return;
    }
    router.replace('/admin');
    router.refresh();
  }

  return <div className="mx-auto mt-20 max-w-md card">
    <h1 className="mb-1 text-2xl font-black">Вход администратора</h1>
    <p className="mb-6 text-slate-500">Закрытая панель управления Cleaning Go.</p>
    <form onSubmit={submit} className="space-y-4">
      <input className="input" type="email" placeholder="Email администратора" value={email} onChange={(event) => setEmail(event.target.value)} required />
      <input className="input" type="password" placeholder="Пароль" value={password} onChange={(event) => setPassword(event.target.value)} required />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="button w-full" disabled={loading}>{loading ? 'Входим…' : 'Войти в панель'}</button>
    </form>
  </div>;
}
