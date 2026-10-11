'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PasswordInput } from '../../components/password-input';
import { Icon } from '../../components/icon';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const result = (await response.json().catch(() => null)) as {
        destination?: string;
        error?: string;
      } | null;

      if (!response.ok || !result?.destination) {
        setError(result?.error ?? 'Не удалось войти. Попробуйте ещё раз.');
        setLoading(false);
        return;
      }
      window.location.assign(result.destination);
    } catch {
      setError('Нет соединения. Проверьте интернет и попробуйте снова.');
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-intro">
        <span className="auth-symbol">
          <Icon name="sparkle" width="28" height="28" />
        </span>
        <p className="section-kicker">С возвращением</p>
        <h1>
          Ваш чистый дом
          <br />
          начинается здесь.
        </h1>
        <p>
          Войдите, чтобы заказать уборку
          <br />
          или продолжить работу.
        </p>
      </div>
      <div className="auth-card card">
        <h2 className="text-2xl font-black">Вход в аккаунт</h2>
        <p className="mt-2 mb-6 text-sm text-slate-500">
          Для клиентов, клинеров и компаний.
        </p>
        <form onSubmit={submit} className="space-y-5">
          <label className="field-label">
            Email
            <input
              className="input mt-2"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="field-label">
            Пароль
            <PasswordInput
              autoComplete="current-password"
              placeholder="Введите пароль"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button className="button w-full" disabled={loading}>
            {loading ? 'Входим…' : 'Войти'}
            <Icon name="arrow" width="18" height="18" />
          </button>
        </form>
        <div className="auth-switch">
          <p>Впервые в Cleaning Go?</p>
          <Link href="/register">
            Создать аккаунт <Icon name="arrow" width="16" height="16" />
          </Link>
        </div>
      </div>
    </div>
  );
}
