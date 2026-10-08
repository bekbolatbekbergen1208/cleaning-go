import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from './supabase/server';

export const trackingStatuses = ['accepted', 'on_the_way', 'arrived', 'in_progress'];
export { inAstana } from './map-coordinates';
export async function trackingAccess(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return null;
  const db = createSupabaseClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const [{ data: profile }, { data: order }, { data: worker }, { data: assignment }] = await Promise.all([
    db.from('profiles').select('role,status').eq('id', user.id).maybeSingle(),
    db.from('orders').select('id,order_number,status,client_id,selected_company_id,address_id,address_text,city').eq('id', id).maybeSingle(),
    db.from('order_workers').select('cleaner_id').eq('order_id', id).eq('cleaner_id', user.id).maybeSingle(),
    db.from('order_assignments').select('cleaner_id,company_id').eq('order_id', id).eq('is_active', true).maybeSingle(),
  ]);
  if (!order || profile?.status !== 'active') return null;
  const isCleaner = ['cleaner', 'company_cleaner'].includes(profile.role) && Boolean(worker || assignment?.cleaner_id === user.id);
  const companyIds = [order.selected_company_id, assignment?.company_id].filter(Boolean) as string[];
  const { data: company } = companyIds.length
    ? await db.from('company_profiles').select('id').in('id', companyIds).eq('owner_id', user.id).maybeSingle()
    : { data: null };
  if (order.client_id !== user.id && !isCleaner && !company) return null;
  return { db, session, user, order, isCleaner };
}
