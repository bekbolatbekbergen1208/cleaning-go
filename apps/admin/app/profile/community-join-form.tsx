'use client';
import { useActionState } from 'react';
import { joinCleanerCommunity } from './actions';

export function CommunityJoinForm() {
  const [message, action, pending] = useActionState(joinCleanerCommunity, '');
  return <form action={action} className="mt-4 space-y-3">
    <label className="block text-sm font-semibold">Код сообщества
      <input className="input mt-1 uppercase" name="community_code" placeholder="COM-XXXXXXXX" required maxLength={32}/>
    </label>
    <button className="button w-full" disabled={pending}>{pending ? 'Присоединяемся…' : 'Вступить в сообщество'}</button>
    {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
  </form>;
}
