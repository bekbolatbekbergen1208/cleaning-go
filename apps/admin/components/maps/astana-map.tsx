'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, LayerGroup, LeafletMouseEvent } from 'leaflet';
import { cityCenter } from '../../lib/city-map';

export type MapPoint = { latitude: number; longitude: number };
export type MapMarker = MapPoint & {
  id: string;
  label: string;
  stale?: boolean;
  destination?: boolean;
};
export function AstanaMap({
  markers = [],
  route = [],
  onPick,
  city = 'Астана',
}: {
  markers?: MapMarker[];
  route?: [number, number][];
  onPick?: (point: MapPoint) => void;
  city?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layers = useRef<LayerGroup | null>(null);
  const pick = useRef(onPick);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const center = cityCenter(city);
  const [error, setError] = useState('');
  pick.current = onPick;

  useEffect(() => {
    fitted.current = false;
    let disposed = false;
    void import('leaflet')
      .then((L) => {
        if (disposed || !container.current) return;
        map.current = L.map(container.current, {
          zoomControl: true,
          scrollWheelZoom: false,
          minZoom: 3,
          maxZoom: 19,
        }).setView([center.latitude, center.longitude], 12);
        L.tileLayer(
          process.env.NEXT_PUBLIC_MAP_TILE_URL ||
            'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          {
            maxZoom: 19,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
          },
        )
          .on('tileerror', () =>
            setError('Не удалось загрузить часть карты. Проверьте интернет.'),
          )
          .addTo(map.current);
        layers.current = L.layerGroup().addTo(map.current);
        map.current.on('click', (event: LeafletMouseEvent) =>
          pick.current?.({
            latitude: event.latlng.lat,
            longitude: event.latlng.lng,
          }),
        );
        setReady(true);
      })
      .catch(() => setError('Не удалось загрузить карту. Обновите страницу.'));
    const observer = new ResizeObserver(() => map.current?.invalidateSize());
    if (container.current) observer.observe(container.current);
    return () => {
      disposed = true;
      observer.disconnect();
      map.current?.remove();
      map.current = null;
      layers.current = null;
    };
  }, [city, center.latitude, center.longitude]);

  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    void import('leaflet').then((L) => {
      if (disposed || !layers.current || !map.current) return;
      layers.current.clearLayers();
      if (route.length)
        L.polyline(
          route.map(([lng, lat]) => [lat, lng] as [number, number]),
          { color: '#2563eb', weight: 5, opacity: 0.85 },
        ).addTo(layers.current);
      markers.forEach((marker) => {
        const label = document.createElement('span');
        label.textContent = marker.label;
        L.circleMarker([marker.latitude, marker.longitude], {
          radius: marker.destination ? 10 : 9,
          color: '#fff',
          weight: 3,
          fillColor: marker.destination
            ? '#f59e0b'
            : marker.stale
              ? '#94a3b8'
              : '#059669',
          fillOpacity: 1,
        })
          .bindTooltip(label, {
            permanent: true,
            direction: 'top',
            offset: [0, -10],
          })
          .addTo(layers.current!);
      });
      if (!fitted.current && markers.length) {
        map.current.fitBounds(
          L.latLngBounds(
            markers.map((p) => [p.latitude, p.longitude] as [number, number]),
          ),
          { padding: [45, 55], maxZoom: 15 },
        );
        fitted.current = true;
      }
    });
    return () => {
      disposed = true;
    };
  }, [ready, markers, route]);

  async function recenter() {
    const L = await import('leaflet');
    if (!map.current) return;
    if (markers.length)
      map.current.fitBounds(
        L.latLngBounds(
          markers.map((p) => [p.latitude, p.longitude] as [number, number]),
        ),
        { padding: [45, 55], maxZoom: 16 },
      );
    else map.current.setView([center.latitude, center.longitude], 12);
  }
  function locateMe() {
    if (!navigator.geolocation) { setError('Геолокация недоступна в браузере.'); return; }
    navigator.geolocation.getCurrentPosition(
      position => map.current?.setView([position.coords.latitude, position.coords.longitude], 16),
      () => setError('Не удалось определить местоположение.'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }
  return (
    <div className="map-shell relative overflow-hidden rounded-2xl border border-slate-200">
      <div
        ref={container}
        className="map-canvas relative z-0 h-[360px] w-full sm:h-[440px]"
        aria-label={`Карта города ${city}`}
      />
      <button
        type="button"
        onClick={() => void recenter()}
        className="absolute right-3 top-3 z-[500] rounded-xl bg-white px-3 py-2 text-xs font-bold shadow"
      >
        Показать все точки
      </button>
      {onPick && <button type="button" onClick={locateMe} className="absolute right-3 top-14 z-[500] rounded-xl bg-white px-3 py-2 text-xs font-bold shadow">Моё местоположение</button>}
      {!ready && !error && (
        <p className="absolute bottom-3 left-3 z-[500] rounded-lg bg-white p-2 text-sm">
          Загружаем карту…
        </p>
      )}
      {error && (
        <p
          role="status"
          className="absolute bottom-6 left-3 right-3 z-[500] rounded-lg bg-white p-2 text-sm text-amber-700"
        >
          {error}
        </p>
      )}
    </div>
  );
}
