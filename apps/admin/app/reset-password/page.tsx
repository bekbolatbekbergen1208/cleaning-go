'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { PasswordInput } from '../../components/password-input';

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const supabase = createClient();
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const code = params.get('code');
      const tokenHash = params.get('token_hash');
      if (code) await supabase.auth.exchangeCodeForSession(code);
      else if (tokenHash) await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
      else if (hash.get('access_token') && hash.get('refresh_token')) await supabase.auth.setSession({ access_token: hash.get('access_token')!, refresh_token: hash.get('refresh_token')! });
      const { data: { user } } = await supabase.auth.getUser();
      setReady(Boolean(user));
      if (!user) setError('Ссылка недействительна или срок её действия истёк. Запросите новую ссылку.');
      window.history.replaceState(null, '', '/reset-password');
    })();
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (password.length < 8) return setError('Пароль должен содержать не менее 8 символов.');
    if (password !== confirm) return setError('Пароли не совпадают.');
    setBusy(true);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (updateError) setError(updateError.message);
    else { setMessage('Пароль обновлён. Теперь можно войти.'); setReady(false); }
  }
  return <div className="auth-shell"><div className="auth-card card mx-auto max-w-md"><h1 className="text-2xl font-black">Новый пароль</h1>
    {ready && <form onSubmit={save} className="mt-6 space-y-4"><label className="field-label">Новый пароль<PasswordInput value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" required /></label><label className="field-label">Повторите пароль<PasswordInput value={confirm} onChange={event => setConfirm(event.target.value)} autoComplete="new-password" required /></label><button className="button w-full" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить пароль'}</button></form>}
    {error && <p role="alert" className="form-error mt-4">{error}</p>}{message && <p role="status" className="mt-4 text-sm font-bold text-emerald-700">{message}</p>}
    <Link href="/login" className="mt-5 inline-block font-bold text-emerald-700">Ко входу →</Link>
  </div></div>;
}
