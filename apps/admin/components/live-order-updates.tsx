'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { createClient } from '../lib/backend/client';

export function LiveOrderUpdates({ userId, companyId, cleanerId }: { userId?: string; companyId?: string; cleanerId?: string }) {
  const router = useRouter();
  useEffect(() => {
    const backend = createClient();
    const channel = backend.channel(`web-order-list-${companyId ?? cleanerId ?? userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: companyId ? `selected_company_id=eq.${companyId}` : cleanerId ? `selected_cleaner_id=eq.${cleanerId}` : `client_id=eq.${userId}` }, () => router.refresh())
      .subscribe();
    return () => { void backend.removeChannel(channel); };
  }, [userId, companyId, cleanerId, router]);
  return null;
}
