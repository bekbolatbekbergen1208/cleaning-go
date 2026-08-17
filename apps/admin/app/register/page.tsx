'use client';
import { createClient } from '../../lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function RegisterPage() {
  const [role, setRole] = useState('client');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setLoading(true);
    const body = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch('/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) { setError(result.error ?? 'Не удалось зарегистрироваться.'); setLoading(false); return; }
    const email = String(body.email).trim().toLowerCase();
    const password = String(body.password);
    const { error: loginError } = await createClient().auth.signInWithPassword({ email, password });
    if (loginError) { setError('Аккаунт создан, но войти автоматически не удалось. Войдите со страницы входа.'); setLoading(false); return; }
    router.replace(body.role === 'company_owner' ? '/company' : '/profile');
    router.refresh();
  }

  return <div className="mx-auto max-w-2xl py-10"><div className="card"><h1 className="text-3xl font-black">Регистрация</h1><p className="mt-2 text-slate-600">Создайте обычный аккаунт Cleaning Go. Административный доступ через эту форму получить нельзя.</p><form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2"><input className="input sm:col-span-2" name="full_name" placeholder="Имя и фамилия" required minLength={2}/><input className="input" name="email" type="email" placeholder="Email" required/><input className="input" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+7 700 000 00 00" required pattern="[+0-9() -]{10,20}"/><input className="input sm:col-span-2" name="password" type="password" placeholder="Пароль от 8 символов" required minLength={8}/><select className="input sm:col-span-2" name="role" value={role} onChange={(e)=>setRole(e.target.value)}><option value="client">Клиент</option><option value="cleaner">Клинер</option><option value="company_owner">Клининговая компания</option></select>{role !== 'company_owner' && <div className="sm:col-span-2"><input className="input uppercase" name="referral_code" placeholder={role === 'cleaner' ? 'Специальный код *' : 'Специальный код (необязательно)'} required={role === 'cleaner'} autoCapitalize="characters"/><p className="mt-2 text-xs text-slate-500">{role === 'cleaner' ? 'Получите код у клининговой компании или Cleaning Go.' : 'Введите код компании или пригласившего пользователя, если он у вас есть.'}</p></div>}{role === 'company_owner' && <><input className="input" name="company_name" placeholder="Название компании" required/><input className="input" name="company_registration_number" placeholder="БИН" required/><input className="input" name="company_city" placeholder="Город" required/><input className="input" name="company_address" placeholder="Адрес" required/><input className="input sm:col-span-2" name="company_phone" type="tel" placeholder="Телефон компании" required/></>}{error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}<button className="button sm:col-span-2" disabled={loading}>{loading ? 'Создаём…' : 'Создать аккаунт'}</button></form></div></div>;
}
