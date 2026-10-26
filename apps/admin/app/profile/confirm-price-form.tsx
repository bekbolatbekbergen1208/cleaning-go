'use client';

import { useActionState } from 'react';
import { confirmCompanyPrice } from './actions';

export function ConfirmPriceForm({ orderId, price }: { orderId: string; price?: string }) {
  const [message, action, pending] = useActionState(confirmCompanyPrice, '');
  return <form action={action} className="mt-3">
    <input type="hidden" name="order_id" value={orderId} />
    {price && <p className="mb-2 text-sm font-semibold">Компания предложила цену {price}</p>}
    {message && <p role="alert" className="mb-2 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">{message}</p>}
    <button className="button w-full" disabled={pending}>{pending ? 'Подтверждаем…' : 'Подтвердить цену'}</button>
  </form>;
}
