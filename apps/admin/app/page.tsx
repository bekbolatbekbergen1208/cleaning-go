import Link from 'next/link';
import { Icon } from '../components/icon';
import { HomeMotion } from './home-motion';
import { redirect } from 'next/navigation';
import { createClient } from '../lib/supabase/server';

const services = [
  {
    icon: 'home',
    title: 'Уборка квартиры',
    text: 'Регулярная или разовая уборка',
    color: 'mint',
  },
  {
    icon: 'sparkle',
    title: 'Генеральная',
    text: 'Глубокая уборка всего дома',
    color: 'lime',
  },
  {
    icon: 'tools',
    title: 'После ремонта',
    text: 'Уберём пыль и строительный мусор',
    color: 'blue',
  },
  {
    icon: 'window',
    title: 'Мытьё окон',
    text: 'Окна, рамы и подоконники',
    color: 'yellow',
  },
  {
    icon: 'sofa',
    title: 'Химчистка',
    text: 'Мебель, ковры и матрасы',
    color: 'violet',
  },
  {
    icon: 'office',
    title: 'Уборка офиса',
    text: 'Чистота рабочего пространства',
    color: 'rose',
  },
] as const;

const advantages = [
  ['✓', 'Проверенные клинеры', 'Исполнители проходят проверку и модерацию.'],
  ['★', 'Качество под контролем', 'Отзывы и рейтинг после каждого заказа.'],
  ['₸', 'Понятная стоимость', 'Цена известна до подтверждения заказа.'],
];

export default async function PublicHome() {
  // Keep the public page available when previewing without backend credentials.
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  ) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

      if (profile?.role === 'company_owner') redirect('/company');
    }
  }

  return (
    <div className="public-home">
      <HomeMotion />
      <section className="home-hero">
        <div className="home-hero-copy">
          <span className="home-eyebrow">Сервис уборки в вашем городе</span>
          <h1>
            Чистый дом —<br />
            <span>без лишних хлопот</span>
          </h1>
          <p>
            Выберите подходящую уборку, удобное время и проверенного
            исполнителя. Всё остальное мы возьмём на себя.
          </p>
          <div className="home-actions">
            <Link href="/order/new" className="landing-primary">
              Заказать уборку <span>→</span>
            </Link>
            <a href="#services" className="landing-secondary">
              Посмотреть услуги
            </a>
          </div>
          <div className="home-trust">
            <b>✓</b>
            <span>Проверенные компании · Цена до подтверждения</span>
          </div>
        </div>
        <div className="home-hero-visual" aria-hidden="true">
          <div className="room-scene">
            <div className="room-window">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="room-sun" />
            <div className="room-picture">✦</div>
            <div className="room-plant">
              <span />
              <span />
              <span />
              <i />
            </div>
            <div className="room-sofa">
              <i />
              <i />
              <span />
            </div>
            <div className="room-rug" />
            <div className="room-table" />
            <div className="room-caption">
              <span>✓</span>
              <div>
                <strong>Время для себя</strong>
                <small>Чистоту доверьте нам</small>
              </div>
            </div>
            <span className="room-sparkle">✦</span>
          </div>
        </div>
      </section>

      <section id="services" className="services-section scroll-mt-24">
        <div className="section-heading">
          <div>
            <p>Наши услуги</p>
            <h2>Что нужно убрать?</h2>
          </div>
          <Link href="/order/new">
            Все услуги <span>→</span>
          </Link>
        </div>
        <div className="service-grid">
          {services.map((service) => (
            <Link
              className="service-tile"
              href="/order/new"
              key={service.title}
            >
              <span className={`service-symbol ${service.color}`}>
                <Icon name={service.icon} />
              </span>
              <strong>{service.title}</strong>
              <small>{service.text}</small>
              <i>
                <Icon name="arrow" width="18" height="18" />
              </i>
            </Link>
          ))}
        </div>
      </section>

      <section id="how" className="how-section scroll-mt-24">
        <div className="section-heading">
          <div>
            <p>Всего три шага</p>
            <h2>Чистота начинается здесь</h2>
          </div>
        </div>
        <div className="how-grid">
          <article>
            <span>01</span>
            <h3>Расскажите об уборке</h3>
            <p>Укажите адрес, удобное время и добавьте фото помещения.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Подтвердите стоимость</h3>
            <p>Выберите компанию и согласуйте предложенную цену.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Занимайтесь своим</h3>
            <p>Следите за заказом, проверьте результат и оставьте отзыв.</p>
          </article>
        </div>
      </section>
      <section className="easy-section">
        <div>
          <p className="home-eyebrow">Почему Cleaning Go</p>
          <h2>
            Спокойно заказывайте.
            <br />
            Мы позаботимся о чистоте.
          </h2>
        </div>
        <div className="advantage-list">
          {advantages.map(([icon, title, text]) => (
            <article key={title}>
              <span>{icon}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="home-final">
        <span className="home-eyebrow">Больше времени на важное</span>
        <h2>А уборку оставьте нам.</h2>
        <Link href="/order/new" className="landing-primary">
          Выбрать уборку <span>→</span>
        </Link>
        <p>Адрес, время, компания — всё в одном месте.</p>
      </section>
      <footer className="home-footer">
        <Link href="/">
          Cleaning <span>Go</span>
        </Link>
        <p>Чистый дом. Спокойный день.</p>
        <Link href="/login">Войти в аккаунт →</Link>
      </footer>
    </div>
  );
}
