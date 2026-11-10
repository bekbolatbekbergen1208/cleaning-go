import { requireAdmin } from '../../lib/require-admin';
import { orderStatusNames as statusNames } from '../../lib/labels';

const money = (v: number) =>
  new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(v / 100);

export default async function Orders() {
  const db = await requireAdmin();
  const { data } = await db
    .from('orders')
    .select('id,order_number,status,address_text,scheduled_at,total_minor,profiles!orders_client_id_fkey(full_name)')
    .order('created_at', { ascending: false })
    .limit(100);
  return (
    <>
      <h1 className="mb-6 text-3xl font-black">Все заказы</h1>
      {/* On phones the table turns into cards (see .responsive-table in globals.css). */}
      <div className="responsive-table-wrap overflow-x-auto card p-0">
        <table className="responsive-table w-full text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              {['Номер', 'Клиент', 'Адрес', 'Статус', 'Дата', 'Сумма'].map((x) => (
                <th className="p-4" key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.map((x) => (
              <tr className="border-t" key={x.id}>
                <td className="p-4 font-semibold whitespace-nowrap" data-label="Номер">{x.order_number}</td>
                <td className="p-4" data-label="Клиент">{(x.profiles as unknown as { full_name: string })?.full_name}</td>
                <td className="p-4" data-label="Адрес">{x.address_text}</td>
                <td className="p-4" data-label="Статус">
                  <span className="rounded-full bg-brand-50 px-2 py-1 text-brand-700">{statusNames[x.status] ?? x.status}</span>
                </td>
                <td className="p-4" data-label="Дата">{new Date(x.scheduled_at).toLocaleString('ru-KZ')}</td>
                <td className="p-4" data-label="Сумма">{money(x.total_minor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.length && <p className="p-5 text-slate-500">Заказов пока нет.</p>}
      </div>
    </>
  );
}
