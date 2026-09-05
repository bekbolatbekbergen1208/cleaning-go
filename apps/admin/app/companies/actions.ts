'use server';

import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/require-admin';

export async function setCompanyFreeAccess(formData: FormData) {
  const session = await requireAdmin();
  const { data: { user } } = await session.auth.getUser();
  if (!user) throw new Error('Администратор не найден');

  const companyId = String(formData.get('id') ?? '');
  const free = formData.get('free') === 'true';
  if (!companyId) throw new Error('Компания не найдена');

  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tariffStatus = free ? 'free' : 'active';
  const { error } = await admin.from('company_profiles').update({ tariff_status: tariffStatus }).eq('id', companyId);
  if (error) throw new Error(error.message);

  await admin.from('admin_action_logs').insert({
    admin_id: user.id,
    action: free ? 'grant_free_company_access' : 'revoke_free_company_access',
    entity_type: 'company',
    entity_id: companyId,
    new_data: { tariff_status: tariffStatus },
  });
  revalidatePath('/companies');
  revalidatePath('/company');
}
