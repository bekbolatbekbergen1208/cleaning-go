import './globals.css';
import type { ReactNode } from 'react';
import { SiteHeader } from './site-header';

export const metadata = { title: 'Cleaning Go', description: 'Сервис заказа уборки' };
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="ru"><body><SiteHeader /><main className="mx-auto max-w-7xl p-5">{children}</main></body></html>;
}
