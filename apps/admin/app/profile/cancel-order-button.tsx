'use client';

import { cancelOrder } from './actions';

export function CancelOrderButton({ orderId }: { orderId: string }) {
  return <form action={cancelOrder} className="mt-3" onSubmit={(event) => {
    if (!window.confirm('Отменить этот заказ? Это действие нельзя отменить.')) event.preventDefault();
  }}>
    <input type="hidden" name="order_id" value={orderId}/>
    <button type="submit" className="min-h-10 w-full rounded-xl border border-red-300 px-4 font-bold text-red-600 transition hover:bg-red-50">Отменить заказ</button>
  </form>;
}
