'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function SiteHeader() {
  const pathname = usePathname();
  const isAdminLogin = pathname === '/admin/login';
  const isAdmin = !isAdminLogin && ['/admin', '/companies', '/orders', '/verifications', '/users', '/services', '/moderation', '/settings'].some((path) => pathname === path || pathname.startsWith(`${path}/`));

  return <><header className="site-header border-b bg-white">
    <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
      <Link href={isAdmin ? '/admin' : '/'} className="text-xl font-black text-brand-700">Cleaning Go{isAdmin ? ' · Admin' : ''}</Link>
      {isAdmin ? <nav className="flex flex-wrap justify-end gap-x-4 gap-y-2 text-sm"><Link href="/admin">Обзор</Link><Link href="/verifications">Проверки</Link><Link href="/orders">Заказы</Link><Link href="/users">Люди</Link><Link href="/services">Услуги</Link><Link href="/moderation">Модерация</Link><Link href="/settings">Настройки</Link></nav> : <><nav className="desktop-public-nav flex items-center gap-7 text-sm font-semibold"><a href="/#services">Услуги</a><a href="/#how">Как это работает</a><Link href="/profile" className="text-emerald-700">Профиль</Link><Link href="/login" className="text-slate-500">Войти</Link><Link href="/register" className="text-emerald-700">Регистрация</Link><Link href="/order/new" className="header-order-button">Заказать уборку</Link></nav>{!isAdminLogin&&<Link href="/register" className="mobile-register-button">Регистрация</Link>}</>}
    </div>
  </header>{!isAdmin && !isAdminLogin && <nav className="mobile-tabbar" aria-label="Основная навигация">
    <Link href="/" className={pathname === '/' ? 'active' : ''}><span>⌂</span><small>Главная</small></Link>
    <Link href="/#services"><span>✦</span><small>Услуги</small></Link>
    <Link href="/order/new" className={pathname.startsWith('/order') ? 'active' : ''}><span className="tab-order-icon">＋</span><small>Заказать</small></Link>
    <Link href="/profile" className={pathname === '/profile' || pathname === '/login' ? 'active' : ''}><span>◎</span><small>Профиль</small></Link>
  </nav>}</>;
}
