'use client';

import { useState } from 'react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
    const result = await response.json().catch(() => null) as { destination?: string; error?: string } | null;

    if (!response.ok || !result?.destination) {
      setError(result?.error ?? 'Не удалось войти. Попробуйте ещё раз.');
      setLoading(false);
      return;
    }
    window.location.assign(result.destination);
  }

  return <div className="mx-auto mt-20 max-w-md card">
    <h1 className="mb-1 text-2xl font-black">Вход в Cleaning Go</h1>
    <p className="mb-6 text-slate-500">Войдите в аккаунт клиента, клинера или компании.</p>
    <form onSubmit={submit} className="space-y-4">
      <input className="input" type="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      <input className="input" type="password" placeholder="Пароль" value={password} onChange={(event) => setPassword(event.target.value)} required />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="button w-full" disabled={loading}>{loading ? 'Входим…' : 'Войти'}</button>
    </form>
  </div>;
}
