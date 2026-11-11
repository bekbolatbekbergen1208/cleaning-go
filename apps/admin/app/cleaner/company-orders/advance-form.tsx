'use client';

import { useActionState } from 'react';
import { advanceCompanyOrderWithState } from './actions';

export function AdvanceOrderForm({
  orderId,
  status,
  label,
}: {
  orderId: string;
  status: string;
  label: string;
}) {
  const [message, action, pending] = useActionState(
    advanceCompanyOrderWithState,
    '',
  );
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="expected_status" value={status} />
      {message && (
        <p
          role="alert"
          className="mb-2 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800"
        >
          {message}
        </p>
      )}
      <button className="button w-full" disabled={pending}>
        {pending ? 'Сохраняем…' : label}
      </button>
    </form>
  );
}
