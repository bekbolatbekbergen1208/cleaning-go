'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function SiteHeader() {
  const pathname = usePathname();
  const isAdmin = ['/admin', '/orders', '/verifications', '/users', '/services', '/moderation', '/settings'].some((path) => pathname === path || pathname.startsWith(`${path}/`));

  return <header className="border-b bg-white">
    <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
      <Link href={isAdmin ? '/admin' : '/'} className="text-xl font-black text-brand-700">Cleaning Go{isAdmin ? ' · Admin' : ''}</Link>
      {isAdmin ? <nav className="flex flex-wrap justify-end gap-x-4 gap-y-2 text-sm"><Link href="/admin">Обзор</Link><Link href="/verifications">Проверки</Link><Link href="/orders">Заказы</Link><Link href="/users">Люди</Link><Link href="/services">Услуги</Link><Link href="/moderation">Модерация</Link><Link href="/settings">Настройки</Link></nav> : <nav className="flex items-center gap-4 text-sm"><a href="#services">Усуги</a><Link href="/login" className="font-semibold text-slate-500">Вход для админа</Link></nav>}
    </div>
  </header>;
}
