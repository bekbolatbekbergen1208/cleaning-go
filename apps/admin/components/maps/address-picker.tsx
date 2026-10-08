'use client';
import { useState } from 'react';
import { AstanaMap, type MapPoint } from './astana-map';
import { inAstana } from '../../lib/map-coordinates';

export function AddressPicker({ value, onChange }: { value: MapPoint | null; onChange: (point: MapPoint) => void }) {
  const [error, setError] = useState('');
  function pick(point: MapPoint) {
    if (!inAstana(point.latitude, point.longitude)) { setError('Выберите адрес в пределах Астаны.'); return; }
    setError(''); onChange(point);
  }
  return <section className="mt-4 space-y-3"><div><p className="font-bold">Точка уборки на карте</p><p className="text-sm text-slate-500">Нажмите на свой дом в Астане. По этой точке клинер построит маршрут.</p></div>
    <AstanaMap markers={value ? [{ ...value, id: 'destination', label: 'Адрес уборки', destination: true }] : []} onPick={pick} />
    <p className="text-sm font-semibold text-emerald-700">{value ? `Точка выбрана: ${value.latitude.toFixed(5)}, ${value.longitude.toFixed(5)}` : 'Выберите точку, чтобы создать заказ.'}</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </section>;
}
