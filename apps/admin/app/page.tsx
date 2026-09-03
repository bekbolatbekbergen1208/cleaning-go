import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '../lib/supabase/server';

const services = [
  { icon: '⌂', title: 'Уборка квартиры', text: 'Регулярная или разовая уборка', color: 'mint' },
  { icon: '✦', title: 'Генеральная', text: 'Глубокая уборка всего дома', color: 'lime' },
  { icon: '▦', title: 'После ремонта', text: 'Уберём пыль и строительный мусор', color: 'blue' },
  { icon: '▤', title: 'Мытьё окон', text: 'Окна, рамы и подоконники', color: 'yellow' },
  { icon: '◇', title: 'Химчистка', text: 'Мебель, ковры и матрасы', color: 'violet' },
  { icon: '▥', title: 'Уборка офиса', text: 'Чистота рабочего пространства', color: 'rose' },
];

const advantages = [
  ['✓', 'Проверенные клинеры', 'Исполнители проходят проверку и модерацию.'],
  ['★', 'Качество под контролем', 'Отзывы и рейтинг после каждого заказа.'],
  ['₸', 'Понятная стоимость', 'Цена известна до подтверждения заказа.'],
];

export default async function PublicHome() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.role === 'company_owner') redirect('/company');
  }

  return <div className="public-home">
    <section className="home-hero">
      <div className="home-hero-copy">
        <span className="home-eyebrow">Сервис уборки в вашем городе</span>
        <h1>Чистый дом —<br/><span>без лишних хлопот</span></h1>
        <p>Выберите подходящую уборку, удобное время и проверенного исполнителя. Всё остальное мы возьмём на себя.</p>
        <div className="home-actions">
          <Link href="/order/new" className="landing-primary">Заказать уборку <span>→</span></Link>
          <a href="#services" className="landing-secondary">Посмотреть услуги</a>
        </div>
        <div className="home-trust"><b>4.9 ★</b><span>Более 1 000 довольных клиентов</span></div>
      </div>
      <div className="home-hero-visual" aria-hidden="true">
        <div className="clean-bubble clean-bubble-one">✦</div>
        <div className="clean-bubble clean-bubble-two">✓</div>
        <div className="clean-house"><span>⌂</span><strong>Дома чисто!</strong><small>Заказ выполнен</small></div>
      </div>
    </section>

    <section id="services" className="services-section scroll-mt-24">
      <div className="section-heading">
        <div><p>Наши услуги</p><h2>Что нужно убрать?</h2></div>
        <Link href="/order/new">Все услуги <span>→</span></Link>
      </div>
      <div className="service-grid">
        {services.map((service) => <Link className="service-tile" href="/order/new" key={service.title}>
          <span className={`service-symbol ${service.color}`}>{service.icon}</span>
          <strong>{service.title}</strong>
          <small>{service.text}</small>
          <i>→</i>
        </Link>)}
      </div>
    </section>

    <section id="how" className="easy-section scroll-mt-24">
      <div><p className="home-eyebrow">Почему Cleaning Go</p><h2>Спокойно заказывайте.<br/>Мы позаботимся о чистоте.</h2></div>
      <div className="advantage-list">{advantages.map(([icon, title, text]) => <article key={title}><span>{icon}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div>
    </section>
  </div>;
}
