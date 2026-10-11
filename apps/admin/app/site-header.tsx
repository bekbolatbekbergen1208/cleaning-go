'use client';
/* eslint-disable @next/next/no-html-link-for-pages -- hash links scroll within the landing page */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '../components/icon';

const adminLinks = [
  ['/admin', 'Обзор'],
  ['/verifications', 'Проверки'],
  ['/orders', 'Заказы'],
  ['/users', 'Люди'],
  ['/services', 'Услуги'],
  ['/moderation', 'Модерация'],
  ['/settings', 'Настройки'],
  ['/communities', 'Сообщества'],
] as const;
const companyLinks = [
  ['/company', 'Кабинет'],
  ['/company/sales', 'Продажи'],
  ['/company/employees', 'Клинеры'],
  ['/company/cities', 'Города'],
  ['/company/orders', 'Заказы'],
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdminLogin = pathname === '/admin/login';
  const isAdmin =
    !isAdminLogin &&
    [
      '/admin',
      '/companies',
      '/communities',
      '/orders',
      '/verifications',
      '/users',
      '/services',
      '/moderation',
      '/settings',
    ].some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const isCompany = pathname === '/company' || pathname.startsWith('/company/');
  const isAuth =
    pathname === '/login' || pathname === '/register' || isAdminLogin;
  useEffect(() => setMenuOpen(false), [pathname]);
  const active = (href: string) =>
    pathname === href ||
    (href !== '/' && href !== '/company' && pathname.startsWith(`${href}/`));
  const tabs: {
    href: string;
    label: string;
    icon: Parameters<typeof Icon>[0]['name'];
    primary?: boolean;
  }[] = isCompany
    ? [
        { href: '/company', label: 'Кабинет', icon: 'home' },
        { href: '/company/orders', label: 'Заказы', icon: 'orders' },
        { href: '/company/sales', label: 'Продажи', icon: 'chart' },
        { href: '/company/employees', label: 'Клинеры', icon: 'people' },
      ]
    : [
        { href: '/', label: 'Главная', icon: 'home' },
        { href: '/#services', label: 'Услуги', icon: 'sparkle' },
        { href: '/order/new', label: 'Заказать', icon: 'plus', primary: true },
        { href: '/profile', label: 'Профиль', icon: 'user' },
      ];

  return (
    <>
      <header
        className={`site-header ${isAdmin ? 'admin-header' : isCompany ? 'company-header' : ''}`}
      >
        <div className="header-inner">
          <Link
            href={isAdmin ? '/admin' : isCompany ? '/company' : '/'}
            className="site-logo"
          >
            <span className="brand-mark">
              <Icon name="sparkle" />
            </span>
            <span>
              Cleaning <b>Go</b>
              {(isAdmin || isCompany) && (
                <small>{isAdmin ? 'Администратор' : 'Кабинет компании'}</small>
              )}
            </span>
          </Link>
          {isAdmin || isCompany ? (
            <>
              <nav
                className="desktop-public-nav"
                aria-label="Навигация кабинета"
              >
                {(isAdmin ? adminLinks : companyLinks).map(([href, label]) => (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active(href) ? 'page' : undefined}
                  >
                    {label}
                  </Link>
                ))}
              </nav>
              <button
                className="mobile-menu-button"
                type="button"
                aria-expanded={menuOpen}
                aria-controls="cabinet-menu"
                aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
                onClick={() => setMenuOpen(!menuOpen)}
              >
                <Icon name={menuOpen ? 'close' : 'menu'} />
              </button>
            </>
          ) : (
            <>
              <nav
                className="desktop-public-nav"
                aria-label="Основная навигация"
              >
                <a href="/#services">Услуги</a>
                <a href="/#how">Как это работает</a>
                <Link href="/profile">Профиль</Link>
                <Link href="/login">Войти</Link>
                <Link href="/order/new" className="header-order-button">
                  Заказать уборку <Icon name="arrow" width="18" height="18" />
                </Link>
              </nav>
              {!isAdminLogin && (
                <Link
                  href={isAuth ? '/' : '/login'}
                  className="mobile-register-button"
                >
                  {isAuth ? 'На главную' : 'Войти'}
                  <Icon
                    name={isAuth ? 'home' : 'user'}
                    width="17"
                    height="17"
                  />
                </Link>
              )}
            </>
          )}
        </div>
        {menuOpen && (isAdmin || isCompany) && (
          <nav
            id="cabinet-menu"
            className="cabinet-menu"
            aria-label="Разделы кабинета"
          >
            {(isAdmin ? adminLinks : companyLinks).map(([href, label]) => (
              <Link
                href={href}
                key={href}
                onClick={() => setMenuOpen(false)}
                aria-current={active(href) ? 'page' : undefined}
              >
                {label}
                <Icon name="arrow" width="18" height="18" />
              </Link>
            ))}
          </nav>
        )}
      </header>
      {!isAdmin && !isAdminLogin && (
        <nav
          className="mobile-tabbar"
          aria-label={isCompany ? 'Навигация компании' : 'Основная навигация'}
        >
          {tabs.map((tab) => {
            const selected =
              active(tab.href) ||
              (tab.href === '/profile' && isAuth) ||
              (tab.primary && pathname.startsWith('/order/'));
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={selected ? 'active' : ''}
                aria-current={selected ? 'page' : undefined}
              >
                <span className={tab.primary ? 'tab-order-icon' : 'tab-icon'}>
                  <Icon name={tab.icon} />
                </span>
                <small>{tab.label}</small>
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}
