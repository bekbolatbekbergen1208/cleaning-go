import { NextRequest, NextResponse } from 'next/server';
import { trackingAccess, trackingStatuses } from '../../../../../lib/tracking';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await trackingAccess((await params).id);
  if (!access || !trackingStatuses.includes(access.order.status)) return NextResponse.json({ error: 'Маршрут недоступен' }, { status: 403 });
  const cleanerId = request.nextUrl.searchParams.get('cleaner');
  if (!cleanerId) return NextResponse.json({ error: 'Выберите клинера' }, { status: 400 });
  const [{ data: point }, { data: address }] = await Promise.all([
    access.db.from('cleaner_locations').select('latitude,longitude,recorded_at').eq('order_id', access.order.id).eq('cleaner_id', cleanerId).maybeSingle(),
    access.db.from('addresses').select('latitude,longitude').eq('id', access.order.address_id).maybeSingle(),
  ]);
  if (!point || !address || address.latitude == null || address.longitude == null || Date.now() - Date.parse(point.recorded_at) > 120_000) return NextResponse.json({ error: 'Для маршрута нужны актуальная геопозиция и точка адреса' }, { status: 409 });
  const start: [number, number] = [Number(point.longitude), Number(point.latitude)];
  const end: [number, number] = [Number(address.longitude), Number(address.latitude)];
  try {
    const base = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';
    const response = await fetch(`${base}/route/v1/driving/${start.join(',')};${end.join(',')}?overview=full&geometries=geojson&steps=false`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
    if (!response.ok) throw new Error('Route failed');
    const data = await response.json();
    const route = data.routes?.[0];
    if (data.code !== 'Ok' || !route?.geometry?.coordinates?.length) throw new Error('No route');
    return NextResponse.json({ coordinates: route.geometry.coordinates, distance: route.distance, duration: route.duration }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Сервис маршрутов временно недоступен. Геопозиция продолжает обновляться.' }, { status: 503 });
  }
}
