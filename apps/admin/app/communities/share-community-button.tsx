'use client';

import { useState } from 'react';

export function ShareCommunityButton({ code, name }: { code: string; name: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}/register?role=cleaner&code=${encodeURIComponent(code)}`;
    const text = `Вступите в сообщество клинеров «${name}». Код: ${code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Cleaning Go', text, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return <button type="button" className="text-sm font-bold text-emerald-700" onClick={share}>
    {copied ? 'Ссылка скопирована' : 'Поделиться'}
  </button>;
}
