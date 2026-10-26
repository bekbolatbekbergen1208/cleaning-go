'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';

export function InvitationCard({
  referralCode,
  companyName,
  locked,
}: {
  referralCode: string | null;
  companyName: string | null;
  locked: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<{
    company_name: string;
    welcome_bonus_minor: number;
  } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const money = (minor: number) => `${(minor / 100).toLocaleString('ru-RU')} ₸`;

  async function copyReferral() {
    if (!referralCode) return;
    await navigator.clipboard.writeText(referralCode);
    setMessage('Реферальный код скопирован.');
  }

  async function shareReferral() {
    if (!referralCode) return;
    const url = `${window.location.origin}/r/${encodeURIComponent(referralCode)}`;
    const message = `Закажите уборку в Cleaning Go по моей ссылке: ${url}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Приглашение в Cleaning Go', text: message, url });
      else { await navigator.clipboard.writeText(message); setMessage('Приглашение скопировано.'); }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage('Не удалось поделиться ссылкой.');
    }
  }

  async function checkCode() {
    setBusy(true);
    setMessage('');
    setPreview(null);
    const { data, error } = await createClient().rpc(
      'preview_invitation_code',
      { input_code: code },
    );
    if (error || !data) setMessage('Код не найден или программа отключена.');
    else
      setPreview(data as { company_name: string; welcome_bonus_minor: number });
    setBusy(false);
  }

  async function applyCode() {
    setBusy(true);
    setMessage('');
    const { data, error } = await createClient().rpc('apply_invitation_code', {
      input_code: code,
    });
    if (error) setMessage(error.message);
    else {
      const result = data as {
        company_name: string;
        welcome_bonus_minor: number;
      };
      setMessage(
        `Компания ${result.company_name} закреплена. Начислено ${money(result.welcome_bonus_minor)}.`,
      );
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <section className="invitation-card card mt-6">
      <h2 className="text-lg font-black">Коды и компания</h2>
      {locked ? (
        <p className="mt-2 text-sm text-slate-600">
          Ваши заказы и бонусы закреплены за компанией{' '}
          <b>{companyName ?? '—'}</b>.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-slate-500">
            Введите код компании или код друга. Перед подтверждением вы увидите
            компанию и приветственный бонус.
          </p>
          <div className="invitation-entry flex gap-2">
            <input
              aria-label="Код приглашения"
              className="input uppercase"
              value={code}
              onChange={(event) => {
                setCode(event.target.value.toUpperCase());
                setPreview(null);
              }}
              placeholder="Код приглашения"
            />
            <button
              className="button"
              type="button"
              disabled={busy || !code.trim()}
              onClick={checkCode}
            >
              Проверить
            </button>
          </div>
          {preview && (
            <div className="rounded-2xl bg-emerald-50 p-4 text-sm">
              <b>{preview.company_name}</b>
              <p className="mt-1 text-emerald-800">
                Приветственный бонус: {money(preview.welcome_bonus_minor)}
              </p>
              <button
                className="button mt-3"
                type="button"
                disabled={busy}
                onClick={applyCode}
              >
                Привязать компанию
              </button>
            </div>
          )}
        </div>
      )}
      <div className="mt-5 rounded-2xl border border-slate-200 p-4">
        <p className="text-xs text-slate-500">Ваш реферальный код</p>
        <div className="referral-copy mt-1 flex items-center justify-between gap-3">
          <b className="truncate text-xl">{referralCode ?? '—'}</b>
          <button
            className="button"
            type="button"
            disabled={!referralCode}
            onClick={copyReferral}
          >
            Копировать
          </button>
        </div>
        <button className="mt-3 text-sm font-bold text-emerald-700" type="button" disabled={!referralCode} onClick={() => void shareReferral()}>Поделиться ссылкой приглашения →</button>
        <p className="mt-2 text-xs text-slate-500">
          Бонус за друга действует только внутри закреплённой компании. Награда
          начисляется только прямому пригласившему.
        </p>
      </div>
      {message && (
        <p className="mt-3 text-sm font-semibold text-emerald-700">{message}</p>
      )}
    </section>
  );
}
