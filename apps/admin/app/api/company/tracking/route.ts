import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '../../../../lib/supabase/server';

const activeStatuses = ['accepted', 'on_the_way', 'arrived', 'in_progress'];

export async function GET() {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Сначала войдите' }, { status: 401 });
  const db = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const [{ data: profile }, { data: company }] = await Promise.all([
    db.from('profiles').select('role,status').eq('id', user.id).maybeSingle(),
    db.from('company_profiles').select('id').eq('owner_id', user.id).maybeSingle(),
  ]);
  if (profile?.role !== 'company_owner' || profile.status !== 'active' || !company) return NextResponse.json({ error: 'Нет доступа' }, { status: 403 });
  const { data: orders, error } = await db.from('orders')
    .select('id,order_number,status,city,address_text,address_id,scheduled_at')
    .eq('selected_company_id', company.id).in('status', activeStatuses).order('scheduled_at');
  if (error) return NextResponse.json({ error: 'Не удалось загрузить заказы' }, { status: 503 });
  const ids = (orders ?? []).map(order => order.id);
  if (!ids.length) return NextResponse.json({ orders: [] }, { headers: { 'Cache-Control': 'no-store' } });
  const addressIds = [...new Set((orders ?? []).map(order => order.address_id).filter(Boolean))];
  const [{ data: workers }, { data: points }, { data: addresses }] = await Promise.all([
    db.from('order_workers').select('order_id,cleaner_id').in('order_id', ids),
    db.from('cleaner_locations').select('order_id,cleaner_id,latitude,longitude,recorded_at').in('order_id', ids),
    addressIds.length ? db.from('addresses').select('id,latitude,longitude').in('id', addressIds) : Promise.resolve({ data: [] }),
  ]);
  const cleanerIds = [...new Set((workers ?? []).map(worker => worker.cleaner_id))];
  const { data: names } = cleanerIds.length ? await db.from('profiles').select('id,full_name').in('id', cleanerIds) : { data: [] };
  const { data: activeCleaners } = cleanerIds.length ? await db.from('cleaner_profiles').select('user_id').in('user_id', cleanerIds).eq('is_available', true).gt('workday_ends_at', new Date().toISOString()) : { data: [] };
  const activeIds = new Set((activeCleaners ?? []).map(item => item.user_id));
  const now = Date.now();
  return NextResponse.json({ orders: (orders ?? []).map(order => {
    const address = (addresses ?? []).find(item => item.id === order.address_id);
    return {
      id: order.id, number: order.order_number, status: order.status, city: order.city,
      address: order.address_text, scheduledAt: order.scheduled_at,
      destination: address?.latitude != null && address.longitude != null ? { latitude: Number(address.latitude), longitude: Number(address.longitude) } : null,
      cleaners: (workers ?? []).filter(worker => worker.order_id === order.id).map(worker => {
        const point = (points ?? []).find(item => item.order_id === order.id && item.cleaner_id === worker.cleaner_id);
        const fresh = point && activeIds.has(worker.cleaner_id) && now - Date.parse(point.recorded_at) <= 120_000;
        return { id: worker.cleaner_id, name: (names ?? []).find(item => item.id === worker.cleaner_id)?.full_name ?? 'Клинер', location: fresh ? { latitude: Number(point.latitude), longitude: Number(point.longitude), recordedAt: point.recorded_at } : null };
      }),
    };
  }) }, { headers: { 'Cache-Control': 'no-store' } });
}
