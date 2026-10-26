'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AstanaMap, type MapMarker } from '../../../components/maps/astana-map';

type Cleaner = { id: string; name: string; location: { latitude: number; longitude: number; recordedAt: string } | null };
type Order = { id: string; number: string; status: string; city: string; address: string; scheduledAt: string; destination: { latitude: number; longitude: number } | null; cleaners: Cleaner[] };
type Route = { coordinates: [number, number][]; distance: number; duration: number };
const statuses: Record<string, string> = { accepted: 'Команда набирается', on_the_way: 'В пути', arrived: 'На месте', in_progress: 'Уборка идёт' };

export function CompanyTracking() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedCleanerId, setSelectedCleanerId] = useState('');
  const [route, setRoute] = useState<Route | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch('/api/company/tracking', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не удалось загрузить карту');
        if (active) { setOrders(data.orders ?? []); setError(''); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Нет соединения'); }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const selected = orders.find(order => order.id === selectedId) ?? orders[0];
  const cleaner = selected?.cleaners.find(item => item.id === selectedCleanerId && item.location) ?? selected?.cleaners.find(item => item.location);
  useEffect(() => {
    let active = true;
    setRoute(null);
    if (!selected?.id || !cleaner?.id || !cleaner.location || !selected.destination) return;
    async function load() {
      const response = await fetch(`/api/orders/${selected!.id}/route?cleaner=${encodeURIComponent(cleaner!.id)}`, { cache: 'no-store' });
      const data = await response.json();
      if (active) setRoute(response.ok ? data : null);
    }
    void load();
    const timer = setInterval(() => void load(), 45_000);
    return () => { active = false; clearInterval(timer); };
  }, [selected, cleaner]);
  const markers: MapMarker[] = selected ? [
    ...(selected.destination ? [{ ...selected.destination, id: 'destination', label: 'Адрес клиента', destination: true }] : []),
    ...selected.cleaners.filter(item => item.location).map(item => ({ ...item.location!, id: item.id, label: item.name })),
  ] : [];
  return <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
    <div className="space-y-3">{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}{orders.length ? orders.map(order => <button key={order.id} type="button" onClick={() => { setSelectedId(order.id); setSelectedCleanerId(''); setRoute(null); }} className={`card block w-full text-left ${selected?.id === order.id ? 'border-emerald-500 bg-emerald-50' : ''}`}>
      <span className="text-xs font-bold text-emerald-700">{statuses[order.status] ?? order.status}</span><b className="mt-1 block">Заказ {order.number}</b><span className="mt-1 block text-sm">{order.city}, {order.address}</span><span className="mt-2 block text-xs text-slate-500">{order.cleaners.length ? order.cleaners.map(item => `${item.name}${item.location ? ' · GPS' : ' · ожидаем GPS'}`).join(', ') : 'Клинеры ещё не назначены'}</span>
    </button>) : !error && <p className="card">Активных заказов пока нет.</p>}</div>
    <div className="card space-y-4">{selected ? <><h2 className="text-xl font-black">Заказ {selected.number}</h2><AstanaMap city={selected.city} markers={markers} route={route?.coordinates ?? []}/><div className="flex flex-wrap gap-2">{selected.cleaners.map(item => <button type="button" key={item.id} disabled={!item.location} onClick={() => { setSelectedCleanerId(item.id); setRoute(null); }} className={cleaner?.id === item.id ? 'button' : 'rounded-xl border px-3 py-2 text-sm font-bold'}>{item.name}</button>)}</div>{cleaner?.location && <p className="text-sm text-slate-500">{cleaner.name}: GPS обновлён {new Date(cleaner.location.recordedAt).toLocaleTimeString('ru-KZ')}</p>}{route && <p className="rounded-xl bg-blue-50 p-3 text-sm font-bold text-blue-800">До клиента: {(route.distance / 1000).toFixed(1)} км · около {Math.max(1, Math.round(route.duration / 60))} мин</p>}<Link href={`/order/${selected.id}/tracking`} className="inline-block text-sm font-bold text-emerald-700">Открыть карту заказа →</Link></> : <p className="text-slate-500">Выберите активный заказ.</p>}</div>
  </div>;
}
