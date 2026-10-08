import { NextRequest, NextResponse } from 'next/server';
import { inAstana, trackingAccess, trackingStatuses } from '../../../../../lib/tracking';
import { isSameOriginRequest, readJsonBody } from '../../../../../lib/request-security';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await trackingAccess((await params).id);
  if (!access) return NextResponse.json({ error: 'Нет доступа к этому заказу' }, { status: 403 });
  const { db, order, user, isCleaner } = access;
  const active = trackingStatuses.includes(order.status);
  const [{ data: address }, { data: locations, error }] = await Promise.all([
    db.from('addresses').select('latitude,longitude').eq('id', order.address_id).maybeSingle(),
    active ? db.from('cleaner_locations').select('cleaner_id,latitude,longitude,heading,speed,recorded_at').eq('order_id', order.id) : Promise.resolve({ data: [], error: null }),
  ]);
  if (error) return NextResponse.json({ error: 'Не удалось загрузить геопозиции' }, { status: 503 });
  const ids = (locations ?? []).map(point => point.cleaner_id);
  const { data: names } = ids.length ? await db.from('profiles').select('id,full_name').in('id', ids) : { data: [] };
  return NextResponse.json({ order, active, isCleaner, isClient: order.client_id === user.id, userId: user.id,
    destination: address?.latitude != null && address.longitude != null ? { latitude: Number(address.latitude), longitude: Number(address.longitude) } : null,
    locations: (locations ?? []).map(point => ({ ...point, latitude: Number(point.latitude), longitude: Number(point.longitude), name: names?.find(name => name.id === point.cleaner_id)?.full_name ?? 'Клинер' })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Недопустимый запрос' }, { status: 403 });
  const access = await trackingAccess((await params).id);
  if (!access?.isCleaner || !trackingStatuses.includes(access.order.status)) return NextResponse.json({ error: 'Передача геопозиции недоступна' }, { status: 403 });
  const body = await readJsonBody<{ latitude: number; longitude: number; heading?: number | null; speed?: number | null }>(request);
  if (!body || typeof body.latitude !== 'number' || typeof body.longitude !== 'number' || !Number.isFinite(body.latitude) || !Number.isFinite(body.longitude) || Math.abs(body.latitude) > 90 || Math.abs(body.longitude) > 180) return NextResponse.json({ error: 'Некорректные координаты' }, { status: 400 });
  const { error } = await access.session.rpc('update_cleaner_location', { target_order_id: access.order.id, lat: body.latitude, lng: body.longitude, target_heading: typeof body.heading === 'number' && Number.isFinite(body.heading) ? body.heading : null, target_speed: typeof body.speed === 'number' && Number.isFinite(body.speed) ? body.speed : null });
  if (error) return NextResponse.json({ error: 'Геопозиция не сохранена. Проверьте подключение и миграцию карты.' }, { status: 409 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Недопустимый запрос' }, { status: 403 });
  const access = await trackingAccess((await params).id);
  if (!access || access.order.client_id !== access.user.id || !trackingStatuses.includes(access.order.status)) return NextResponse.json({ error: 'Адрес может отметить только клиент активного заказа' }, { status: 403 });
  const body = await readJsonBody<{ latitude: number; longitude: number }>(request);
  if (!body || typeof body.latitude !== 'number' || typeof body.longitude !== 'number' || !inAstana(body.latitude, body.longitude)) return NextResponse.json({ error: 'Выберите точку в Астане' }, { status: 400 });
  const { data, error } = await access.db.from('addresses').update({ latitude: body.latitude, longitude: body.longitude }).eq('id', access.order.address_id).eq('user_id', access.user.id).is('latitude', null).select('id').maybeSingle();
  if (error || !data) return NextResponse.json({ error: 'Точка уже сохранена или адрес недоступен. Обновите страницу.' }, { status: 409 });
  return NextResponse.json({ ok: true });
}
