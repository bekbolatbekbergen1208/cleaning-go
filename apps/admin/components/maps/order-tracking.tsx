'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { AstanaMap, type MapPoint, type MapMarker } from './astana-map';
import { AddressPicker } from './address-picker';
import { isAstana } from '../../lib/map-coordinates';

type Location = MapPoint & { cleaner_id: string; name: string; recorded_at: string };
type Snapshot = { order: { status: string; city: string }; active: boolean; isCleaner: boolean; isClient: boolean; userId: string; destination: MapPoint | null; locations: Location[] };
type Route = { coordinates: [number, number][]; distance: number; duration: number };
const statusLabels: Record<string, string> = { accepted: 'Команда набирается', on_the_way: 'Клинер в пути', arrived: 'Клинер на месте', in_progress: 'Уборка идёт', completed_by_cleaner: 'Ожидается подтверждение', completed: 'Завершён', cancelled: 'Отменён', disputed: 'Спор' };

export function OrderTracking({ orderId }: { orderId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [selectedCleaner, setSelectedCleaner] = useState('');
  const [route, setRoute] = useState<Route | null>(null);
  const [routeError, setRouteError] = useState('');
  const [destinationDraft, setDestinationDraft] = useState<MapPoint | null>(null);
  const [savingDestination, setSavingDestination] = useState(false);
  const [now, setNow] = useState(Date.now());
  const watcher = useRef<number | null>(null);
  const sending = useRef(false);
  const latestPosition = useRef<GeolocationPosition | null>(null);
  const lastSent = useRef(0);
  const generation = useRef(0);
  const latestSnapshot = useRef<Snapshot | null>(null);
  latestSnapshot.current = snapshot;

  useEffect(() => {
    let disposed = false;
    let loading = false;
    const controller = new AbortController();
    async function refresh() {
      if (loading || disposed) return;
      loading = true;
      try {
        const response = await fetch(`/api/orders/${orderId}/tracking`, { cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не удалось загрузить карту');
        if (!disposed) { setSnapshot(data); setError(''); }
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : 'Соединение потеряно'); }
      finally { loading = false; }
    }
    void refresh();
    const supabase = createClient();
    const channel = supabase.channel(`tracking-${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cleaner_locations', filter: `order_id=eq.${orderId}` }, () => void refresh())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }, () => void refresh())
      .subscribe();
    const poll = setInterval(() => { setNow(Date.now()); void refresh(); }, 10_000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { disposed = true; controller.abort(); clearInterval(poll); document.removeEventListener('visibilitychange', visible); void supabase.removeChannel(channel); };
  }, [orderId]);

  const stopSharing = useCallback(() => {
    generation.current += 1;
    if (watcher.current !== null) navigator.geolocation.clearWatch(watcher.current);
    watcher.current = null; latestPosition.current = null; lastSent.current = 0; setSharing(false);
  }, []);

  function startSharing() {
    if (watcher.current !== null) return;
    if (!window.isSecureContext || !navigator.geolocation) { setGpsError('Геолокация доступна через HTTPS или localhost.'); return; }
    setGpsError(''); setSharing(true);
    watcher.current = navigator.geolocation.watchPosition(position => { latestPosition.current = position; }, failure => {
      setGpsError(failure.code === 1 ? 'Разрешите доступ к геолокации в настройках браузера и попробуйте снова.' : 'Не удалось получить GPS. Проверьте геолокацию и попробуйте снова.');
      if (failure.code === 1) stopSharing();
    }, { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 });
  }

  useEffect(() => {
    if (!sharing) return;
    let disposed = false;
    const epoch = generation.current;
    const controller = new AbortController();
    async function send() {
      const position = latestPosition.current;
      if (disposed || sending.current || !position || Date.now() - position.timestamp > 30_000 || Date.now() - lastSent.current < 10_000) return;
      sending.current = true;
      try {
        const { latitude, longitude, heading, speed } = position.coords;
        const response = await fetch(`/api/orders/${orderId}/tracking`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ latitude, longitude, heading, speed }), signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!disposed && generation.current === epoch) { lastSent.current = Date.now(); setGpsError(''); }
      } catch (e) { if (!disposed && generation.current === epoch) setGpsError(e instanceof Error ? e.message : 'Геопозиция не отправлена'); }
      finally { sending.current = false; }
    }
    const timer = setInterval(() => void send(), 1_000);
    return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, [sharing, orderId]);

  const trackingActive = snapshot?.active;
  useEffect(() => { if (trackingActive === false) stopSharing(); }, [trackingActive, stopSharing]);
  useEffect(() => () => {
    generation.current += 1;
    if (watcher.current !== null) navigator.geolocation.clearWatch(watcher.current);
  }, []);

  const locations = snapshot?.active ? snapshot.locations : [];
  const currentCleaner = locations.some(point => point.cleaner_id === selectedCleaner) ? selectedCleaner : locations[0]?.cleaner_id ?? '';
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    setRoute(null); setRouteError('');
    async function updateRoute() {
      const state = latestSnapshot.current;
      const point = state?.locations.find(item => item.cleaner_id === currentCleaner);
      if (!state?.active || !point || !state.destination || !isAstana(state.order.city) || Date.now() - Date.parse(point.recorded_at) > 120_000) {
        if (!disposed) { setRoute(null); setRouteError(''); } return;
      }
      try {
        const response = await fetch(`/api/orders/${orderId}/route?cleaner=${encodeURIComponent(currentCleaner)}`, { cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!disposed) { setRoute(data); setRouteError(''); }
      } catch (e) { if (!disposed) { setRoute(null); setRouteError(e instanceof Error ? e.message : 'Маршрут недоступен'); } }
    }
    void updateRoute(); const timer = setInterval(() => void updateRoute(), 45_000);
    return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, [currentCleaner, orderId, snapshot?.active, snapshot?.destination?.latitude, snapshot?.destination?.longitude]);

  async function saveDestination() {
    if (!destinationDraft) return;
    setSavingDestination(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/tracking`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(destinationDraft) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSnapshot(current => current ? { ...current, destination: destinationDraft } : current);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Адрес не сохранён'); }
    finally { setSavingDestination(false); }
  }

  if (!snapshot) return <section className="card"><p role="status">{error || 'Загружаем геопозиции…'}</p></section>;
  const chosen = locations.find(point => point.cleaner_id === currentCleaner);
  const fresh = chosen && now - Date.parse(chosen.recorded_at) <= 120_000;
  const markers: MapMarker[] = [
    ...(snapshot.destination ? [{ ...snapshot.destination, id: 'destination', label: 'Адрес уборки', destination: true }] : []),
    ...locations.map(point => ({ ...point, id: point.cleaner_id, label: point.name, stale: now - Date.parse(point.recorded_at) > 120_000 })),
  ];
  return <section className="card space-y-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black">Клинеры на карте</h2><p className="mt-1 text-sm text-slate-500">{statusLabels[snapshot.order.status] ?? snapshot.order.status}</p></div><span className={`rounded-full px-3 py-2 text-xs font-bold ${fresh && !error ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{fresh && !error ? 'Геопозиция обновляется' : 'Ожидаем актуальный GPS'}</span></div>
    {!isAstana(snapshot.order.city) ? <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Карта и маршруты пока доступны для заказов в Астане.</p> : <>
      {snapshot.isCleaner && snapshot.active && <div className="rounded-2xl bg-emerald-50 p-4"><p className="font-bold">Поделитесь своим местоположением</p><p className="mt-1 text-sm text-emerald-800">Клиент и компания увидят вас на карте этого заказа. Разрешите геолокацию и держите эту страницу открытой. При закрытии вкладки или блокировке телефона передача может остановиться.</p><button type="button" onClick={sharing ? stopSharing : startSharing} className="button mt-3">{sharing ? 'Остановить передачу' : 'Включить геолокацию'}</button><p className="mt-2 text-xs">{sharing ? 'Передаём GPS примерно раз в 10 секунд.' : 'Передача выключена.'}</p>{gpsError && <p role="alert" className="mt-2 text-sm text-red-700">{gpsError}</p>}</div>}
      {!snapshot.active && <p className="rounded-xl bg-slate-50 p-4 text-sm">Отслеживание остановлено: заказ больше не в активной работе.</p>}
      {!snapshot.destination && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">У этого заказа ещё нет точки адреса. Клиент может отметить дом на карте ниже, чтобы построить маршрут.</p>}
      {!snapshot.destination && snapshot.isClient && snapshot.active && <div><AddressPicker value={destinationDraft} onChange={setDestinationDraft} /><button type="button" className="button mt-3" disabled={!destinationDraft || savingDestination} onClick={() => void saveDestination()}>{savingDestination ? 'Сохраняем…' : 'Сохранить точку адреса'}</button></div>}
      <AstanaMap markers={markers} route={fresh && snapshot.active ? route?.coordinates ?? [] : []} />
      {snapshot.active && !locations.length && <p className="text-sm text-slate-500">Ожидаем, когда назначенные клинеры включат геолокацию.</p>}
      {locations.length > 0 && <div className="grid gap-2 sm:grid-cols-2">{locations.map(point => <button type="button" key={point.cleaner_id} onClick={() => setSelectedCleaner(point.cleaner_id)} className={`rounded-xl border p-3 text-left ${point.cleaner_id === currentCleaner ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'}`}><b className="text-sm">{point.name}</b><p className="mt-1 text-xs text-slate-500">{now - Date.parse(point.recorded_at) > 120_000 ? 'Связь потеряна · последняя точка' : 'Обновлено'} {new Date(point.recorded_at).toLocaleTimeString('ru-KZ')}</p></button>)}</div>}
      {fresh && route && snapshot.active && <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-900"><b>Маршрут: {(route.distance / 1000).toFixed(1)} км · около {Math.max(1, Math.round(route.duration / 60))} мин</b><p className="mt-1 text-xs">Автомобильный маршрут до адреса уборки. Время приблизительное, без учёта пробок.</p></div>}
      {routeError && <p role="status" className="text-sm text-amber-700">{routeError}</p>}
    </>}
    {error && <p role="alert" className="text-sm text-red-600">{error}. Повторяем подключение автоматически.</p>}
  </section>;
}
