import './globals.css';
import 'leaflet/dist/leaflet.css';
import type { Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteHeader } from './site-header';

export const metadata = {
  title: 'Cleaning Go',
  description: 'Сервис заказа уборки',
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#087562',
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <SiteHeader />
        <main className="site-main mx-auto max-w-7xl p-5">{children}</main>
      </body>
    </html>
  );
}
