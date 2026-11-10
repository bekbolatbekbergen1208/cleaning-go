import './globals.css';
import 'leaflet/dist/leaflet.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteHeader } from './site-header';

export const metadata: Metadata = {
  title: 'Cleaning Go',
  description: 'Сервис заказа уборки',
  // iPhone "Add to Home Screen": full-screen app, readable status bar.
  appleWebApp: { capable: true, title: 'Cleaning Go', statusBarStyle: 'default' },
  // Stop iOS/Samsung from turning order numbers and dates into phone links.
  formatDetection: { telephone: false, email: false, address: false },
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
