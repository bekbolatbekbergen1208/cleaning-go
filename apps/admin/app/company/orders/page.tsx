import { createClient as createAdminClient } from '@supabase/supabase-js';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server';
import { proposeCompanyPrice, updatePublishedOrder } from './actions';

const statusNames: Record<string, string> = {
  searching: 'Ожидает компании',
  offered: 'Цена предложена клиенту',
  awaiting_price: 'Ожидает цены',
  price_proposed: 'Цена предложена',
  accepted: 'Принят',
  on_the_way: 'В пути',
  arrived: 'На месте',
  in_progress: 'В работе',
  completed_by_cleaner: 'Ожидает завершения',
  completed: 'Завершён',
  cancelled: 'Отменён',
};

function contactPhone(phone?: string) {
  let digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits;
}

export default async function CompanyOrders() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: profile }, { data: company }] = await Promise.all([
    admin.from('profiles').select('role,status').eq('id', user.id).single(),
    admin.from('company_profiles').select('id,name').eq('owner_id', user.id).single(),
  ]);
  if (profile?.role !== 'company_owner' || profile.status !== 'active' || !company) redirect('/login?error=company_account');

  const { data: orders, error } = await admin
    .from('orders')
    .select('id,order_number,status,address_text,city,scheduled_at,area_sq_m,rooms_count,total_minor,executor_amount_minor,required_workers,price_confirmed_at,photo_urls,created_at,profiles!orders_client_id_fkey(full_name,phone)')
    .eq('selected_company_id', company.id)
    .order('created_at', { ascending: false });

  const roomPhotos = new Map<string, string[]>();
  await Promise.all((orders ?? []).map(async order => {
    const paths = ((order.photo_urls ?? []) as string[]).filter(path => !path.includes('/completion-'));
    if (!paths.length) return;
    const { data } = await admin.storage.from('order-photos').createSignedUrls(paths, 3600);
    roomPhotos.set(order.id, (data ?? []).map(item => item.signedUrl).filter((url): url is string => Boolean(url)));
  }));

  return <div className="mx-auto max-w-5xl px-4 py-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-bold text-emerald-700">{company.name}</p><h1 className="text-3xl font-black">Заказы компании</h1></div><Link className="rounded-xl border px-4 py-2 font-bold" href="/company">← Кабинет</Link></div>
    {error ? <p className="card mt-6 text-red-600">Не удалось загрузить заказы: {error.message}</p> : orders?.length ? <div className="mt-6 space-y-3">{orders.map((order) => {
      const client = order.profiles as unknown as { full_name?: string; phone?: string } | null;
      const phone = contactPhone(client?.phone);
      const waitingForClient = order.status === 'offered' && !order.price_confirmed_at;
      return <article className="card" key={order.id}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-black">Заказ {order.order_number}</h2><p className="mt-1 text-sm text-slate-500">{client?.full_name ?? 'Клиент'} · {client?.phone ?? 'телефон не указан'}</p>{phone && <div className="mt-3 flex flex-wrap gap-2"><a className="rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white" href={`https://wa.me/${phone}?text=${encodeURIComponent(`Здравствуйте! Пишем по вашему заказу ${order.order_number} в Cleaning Go.`)}`} target="_blank" rel="noreferrer">Написать в WhatsApp</a><a className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white" href={`tel:+${phone}`}>Позвонить</a></div>}</div><span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700">{statusNames[order.status] ?? order.status}</span></div>
        <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2"><p><b>Адрес:</b> {order.city}, {order.address_text}</p><p><b>Дата:</b> {new Date(order.scheduled_at).toLocaleString('ru-KZ')}</p><p><b>Помещение:</b> {order.area_sq_m} м², {order.rooms_count} комн.</p><p><b>Сумма:</b> {(Number(order.total_minor) / 100).toLocaleString('ru-RU')} ₸</p></div>
        {Boolean(roomPhotos.get(order.id)?.length) && <div className="mt-4"><p className="mb-2 text-sm font-bold text-slate-700">Фото помещения</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{roomPhotos.get(order.id)?.map((url, index) => <a href={url} target="_blank" rel="noreferrer" key={url}><img className="h-40 w-full rounded-xl object-cover" src={url} alt={`Фото помещения ${index + 1}`}/></a>)}</div></div>}
        {order.status === 'searching' ? <form action={proposeCompanyPrice} className="mt-5 grid gap-3 rounded-2xl bg-emerald-50 p-4 sm:grid-cols-3">
          <input type="hidden" name="order_id" value={order.id}/>
          <label className="text-sm font-bold text-emerald-900">Цена для клиента, ₸<input className="input mt-1 bg-white" name="total_kzt" type="number" min="100" step="1" required/></label>
          <label className="text-sm font-bold text-emerald-900">Количество клинеров<input className="input mt-1 bg-white" name="required_workers" type="number" min="1" max="50" defaultValue="1" required/></label>
          <label className="text-sm font-bold text-emerald-900">Общая выплата клинерам, ₸<input className="input mt-1 bg-white" name="cleaner_amount_kzt" type="number" min="0" required/></label>
          <p className="text-sm text-emerald-700 sm:col-span-3">Когда клиент подтвердит цену, заказ сразу появится у клинеров.</p>
          <button className="button sm:col-span-3">Отправить цену клиенту</button>
        </form> : waitingForClient ? <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-700"><p>Ожидаем подтверждения цены клиентом</p><p className="mt-1">Клинеров: {order.required_workers} · Выплата: {(Number(order.executor_amount_minor) / 100).toLocaleString('ru-RU')} ₸</p></div> : order.status === 'accepted' ? <form action={updatePublishedOrder} className="mt-5 grid gap-3 rounded-2xl bg-blue-50 p-4 sm:grid-cols-2">
          <input type="hidden" name="order_id" value={order.id}/><p className="font-bold text-blue-700 sm:col-span-2">Заказ опубликован в общем сообществе клинеров</p>
          <label className="text-sm font-bold text-blue-900">Количество клинеров<input className="input mt-1 bg-white" name="required_workers" type="number" min="1" max="50" defaultValue={order.required_workers ?? 1} required/></label>
          <label className="text-sm font-bold text-blue-900">Общая выплата клинерам, ₸<input className="input mt-1 bg-white" name="cleaner_amount_kzt" type="number" min="0" max={Number(order.total_minor)/100} defaultValue={Number(order.executor_amount_minor)/100} required/></label>
          <p className="text-sm text-blue-700 sm:col-span-2">Выплата одному клинеру будет рассчитана из общей суммы.</p><button className="button sm:col-span-2">Сохранить количество и выплату</button>
        </form> : null}
      </article>;
    })}</div> : <div className="card mt-6 text-center"><p className="text-xl font-black">Заказов пока нет</p><p className="mt-2 text-sm text-slate-500">Новые заказы, отправленные вашей компании, появятся здесь.</p></div>}
  </div>;
}
