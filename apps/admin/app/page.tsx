import Link from 'next/link';

const advantages = [
  ['✓', 'Проверенные клинеры', 'Каждый исполнитель проходит проверку и модерацию.'],
  ['♡', 'Качество под контролем', 'Рейтинги и отзывы помогают выбрать лучшего.'],
  ['◎', '5% за рекомендацию', 'Делитесь Cleaning Go с друзьями и получайте бонусы.'],
];

export default function PublicHome() {
  return <div className="pb-16">
    <section className="landing-shell">
      <div className="landing-card">
        <div className="landing-orb landing-orb-one" />
        <div className="landing-orb landing-orb-two" />
        <div className="relative z-10 flex h-full flex-col">
          <div className="flex items-center gap-3 text-sm font-extrabold"><span className="grid h-9 w-9 place-items-center rounded-xl bg-lime-300 text-lg text-emerald-950">C</span>Cleaning Go</div>
          <div className="mt-8 h-2 w-40 overflow-hidden rounded-full bg-white/15"><div className="h-full w-2/3 rounded-full bg-lime-300" /></div>
          <h1 className="mt-9 text-5xl font-black leading-[0.98] tracking-tight sm:text-6xl">Свежий дом.<br/><span className="text-lime-300">Свободное<br/>время.</span></h1>
          <p className="mt-6 max-w-md text-sm leading-6 text-emerald-50/80">Cleaning Go — современный сервис для тех, кто ценит чистоту и своё время. Выберите усугу, а остальное мы возьмём на себя.</p>
          <div className="mt-7 grid gap-3">
            <Link href="/register" className="landing-primary">Сделать заказ</Link>
            <Link href="/login" className="landing-secondary">Войти</Link>
          </div>
          <div className="mt-auto flex items-center gap-4 pt-8">
            <div className="flex -space-x-2"><span className="avatar bg-amber-100">A</span><span className="avatar bg-cyan-100">C</span><span className="avatar bg-violet-100">E</span></div>
            <div><p className="font-black">4.9 <span className="text-lime-300">★</span></p><p className="text-xs text-emerald-50/65">Более 1 000 довольных клиентов</p></div>
          </div>
        </div>
      </div>

      <div className="landing-copy">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">Почему Cleaning Go</p>
        <h2 className="mt-4 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">Всё для спокойного заказа</h2>
        <div className="mt-10 space-y-8">{advantages.map(([icon,title,text]) => <article className="flex gap-5" key={title}><span className="feature-icon">{icon}</span><div><h3 className="text-lg font-black">{title}</h3><p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{text}</p></div></article>)}</div>
        <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-xs font-semibold text-slate-400"><span>♢ Безопасная оплата</span><span>◇ Поддержка 7 дней в неделю</span></div>
      </div>
    </section>

    <section id="services" className="mt-14 scroll-mt-24 border-t border-slate-200 pt-10">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Как это работает</p>
      <h2 className="mt-2 text-3xl font-black">Уборка без лишних хлопот</h2>
    </section>
  </div>;
}
