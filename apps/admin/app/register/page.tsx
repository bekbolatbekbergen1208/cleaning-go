'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PasswordInput } from '../../components/password-input';
import { Icon } from '../../components/icon';

export default function RegisterPage() {
  const [role, setRole] = useState('client');
  const [referralCode, setReferralCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invitedRole = params.get('role');
    const code = params.get('code');
    if (invitedRole === 'cleaner') setRole('cleaner');
    if (code) setReferralCode(code.trim().toUpperCase());
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? 'Не удалось зарегистрироваться.');
        setLoading(false);
        return;
      }
      const email = String(body.email).trim().toLowerCase();
      const password = String(body.password);
      const loginResponse = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const loginResult = (await loginResponse.json().catch(() => null)) as {
        destination?: string;
        error?: string;
      } | null;
      if (!loginResponse.ok || !loginResult?.destination) {
        setError(
          loginResult?.error ??
            'Аккаунт создан, но войти автоматически не удалось. Войдите со страницы входа.',
        );
        setLoading(false);
        return;
      }
      window.location.assign(loginResult.destination);
    } catch {
      setError('Нет соединения. Проверьте интернет и попробуйте снова.');
      setLoading(false);
    }
  }

  return (
    <div className="registration-shell">
      <div className="page-heading">
        <p className="section-kicker">Добро пожаловать</p>
        <h1>Давайте знакомиться</h1>
        <p>Создайте аккаунт для заказа уборки или работы в сервисе.</p>
      </div>
      <div className="card registration-card">
        <fieldset className="role-picker">
          <legend>Как вы будете пользоваться сервисом?</legend>
          <div>
            {(
              [
                ['client', 'Клиент', 'Заказывать уборку', 'home'],
                ['cleaner', 'Клинер', 'Выполнять заказы', 'sparkle'],
                ['company_owner', 'Компания', 'Управлять заказами', 'people'],
              ] as const
            ).map(([value, title, description, icon]) => (
              <button
                key={value}
                type="button"
                aria-pressed={role === value}
                className={role === value ? 'selected' : ''}
                onClick={() => setRole(value)}
              >
                <Icon name={icon as 'home' | 'sparkle' | 'people'} />
                <b>{title}</b>
                <small>{description}</small>
              </button>
            ))}
          </div>
        </fieldset>
        <form onSubmit={submit} className="mt-6 grid gap-5 sm:grid-cols-2">
          <input type="hidden" name="role" value={role} />
          <label className="field-label sm:col-span-2">
            Имя и фамилия
            <input
              className="input mt-2"
              name="full_name"
              autoComplete="name"
              placeholder="Как к вам обращаться"
              required
              minLength={2}
            />
          </label>
          <label className="field-label">
            Email
            <input
              className="input mt-2"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              placeholder="you@example.com"
              required
            />
          </label>
          <label className="field-label">
            Телефон
            <input
              className="input mt-2"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+7 700 000 00 00"
              required
              pattern="[+0-9() -]{10,20}"
            />
          </label>
          <label className="field-label sm:col-span-2">
            Пароль
            <PasswordInput
              name="password"
              autoComplete="new-password"
              placeholder="Минимум 8 символов"
              required
              minLength={8}
            />
          </label>
          {role !== 'company_owner' && (
            <label className="field-label sm:col-span-2">
              {role === 'cleaner' ? 'Код сообщества' : 'Код приглашения'}
              {role === 'client' && (
                <span className="optional-label">необязательно</span>
              )}
              <input
                className="input mt-2 uppercase"
                name="referral_code"
                value={referralCode}
                onChange={(event) =>
                  setReferralCode(event.target.value.toUpperCase())
                }
                placeholder={
                  role === 'cleaner'
                    ? 'COM-XXXXXXXX'
                    : 'Введите код, если он у вас есть'
                }
                required={role === 'cleaner'}
                autoCapitalize="characters"
              />
              <small className="field-hint">
                {role === 'cleaner'
                  ? 'Получите код сообщества у администратора или компании.'
                  : 'Код компании или пользователя, который вас пригласил.'}
              </small>
            </label>
          )}
          {role === 'company_owner' && (
            <fieldset className="company-fields sm:col-span-2">
              <legend>О компании</legend>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="field-label sm:col-span-2">
                  Название
                  <input
                    className="input mt-2"
                    name="company_name"
                    autoComplete="organization"
                    placeholder="Название компании"
                    required
                  />
                </label>
                <label className="field-label">
                  БИН
                  <input
                    className="input mt-2"
                    name="company_registration_number"
                    inputMode="numeric"
                    placeholder="БИН компании"
                    required
                  />
                </label>
                <label className="field-label">
                  Город
                  <input
                    className="input mt-2"
                    name="company_city"
                    autoComplete="address-level2"
                    placeholder="Город работы"
                    required
                  />
                </label>
                <label className="field-label sm:col-span-2">
                  Адрес
                  <input
                    className="input mt-2"
                    name="company_address"
                    autoComplete="street-address"
                    placeholder="Улица, дом"
                    required
                  />
                </label>
                <label className="field-label sm:col-span-2">
                  Телефон компании
                  <input
                    className="input mt-2"
                    name="company_phone"
                    type="tel"
                    inputMode="tel"
                    placeholder="+7 700 000 00 00"
                    required
                  />
                </label>
              </div>
            </fieldset>
          )}
          {error && (
            <p role="alert" className="form-error sm:col-span-2">
              {error}
            </p>
          )}
          <button className="button sm:col-span-2" disabled={loading}>
            {loading ? 'Создаём аккаунт…' : 'Создать аккаунт'}
            <Icon name="arrow" width="18" height="18" />
          </button>
        </form>
        <div className="auth-switch">
          <p>Уже есть аккаунт?</p>
          <Link href="/login">
            Войти <Icon name="arrow" width="16" height="16" />
          </Link>
        </div>
      </div>
    </div>
  );
}
