'use client';

import { useEffect, useState } from 'react';
import { humanizeCodes } from '../../lib/labels';
import { createClient } from '../../lib/backend/client';

type Notice = { id: string; title: string; body: string; created_at: string };
export function NotificationFeed({ userId }: { userId: string }) {
  const [items, setItems] = useState<Notice[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const backend = createClient();
    let active = true;
    void backend.from('notifications').select('id,title,body,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(100).then(({ data, error: loadError }) => {
      if (!active) return;
      if (loadError) setError('Не удалось загрузить уведомления.');
      else setItems((data ?? []) as Notice[]);
    });
    const channel = backend.channel(`web-notifications-${userId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, payload => {
      const notice = payload.new as Notice;
      setItems(current => [notice, ...current.filter(item => item.id !== notice.id)].slice(0, 100));
    }).subscribe();
    return () => { active = false; void backend.removeChannel(channel); };
  }, [userId]);
  return <div className="mt-6 space-y-3">{error && <p role="alert" className="text-red-600">{error}</p>}{items.length ? items.map(item => <article className="card" key={item.id}><h2 className="font-black">{item.title}</h2><p className="mt-1 text-sm">{humanizeCodes(item.body)}</p><p className="mt-2 text-xs text-slate-500">{new Date(item.created_at).toLocaleString('ru-KZ')}</p></article>) : !error && <p className="card">Новых уведомлений пока нет.</p>}</div>;
}
