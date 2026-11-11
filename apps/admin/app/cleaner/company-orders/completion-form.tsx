'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/backend/client';
import { advanceCompanyOrder } from './actions';

export function CompletionForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const input = event.currentTarget.elements.namedItem(
        'photos',
      ) as HTMLInputElement;
      const files = Array.from(input.files ?? []);
      if (!files.length) throw new Error('Добавьте хотя бы одну фотографию.');
      if (files.length > 5)
        throw new Error('Можно загрузить не более 5 фотографий.');
      const backend = createClient();
      const {
        data: { user },
        error: sessionError,
      } = await backend.auth.getUser();
      if (sessionError)
        throw new Error(
          'Не удалось проверить вход. Проверьте соединение и повторите.',
        );
      if (!user) {
        router.replace('/login');
        return;
      }
      const paths: string[] = [];
      for (const [index, file] of files.entries()) {
        if (
          !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
          file.size === 0 ||
          file.size > 10 * 1024 * 1024
        )
          throw new Error('Фото должно быть JPEG, PNG или WebP до 10 МБ.');
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${user.id}/completion-${orderId}-${Date.now()}-${index}-${safeName}`;
        const { error: uploadError } = await backend.storage
          .from('order-photos')
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError)
          throw new Error(`Не удалось загрузить фото: ${uploadError.message}`);
        paths.push(path);
      }
      const formData = new FormData();
      formData.set('order_id', orderId);
      formData.set('expected_status', 'in_progress');
      formData.set('completion_photo_paths', JSON.stringify(paths));
      await advanceCompanyOrder(formData);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Не удалось завершить заказ.',
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="mt-3 rounded-2xl bg-sky-50 p-4" onSubmit={submit}>
      <label className="block text-sm font-bold text-sky-900">
        Фотоотчёт после уборки
        <input
          className="mt-2 block w-full text-sm"
          name="photos"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          required
        />
      </label>
      <p className="mt-2 text-xs text-slate-500">
        До 5 фотографий. Клиент увидит их перед подтверждением.
      </p>
      {error && <p className="mt-2 text-sm font-bold text-red-600">{error}</p>}
      <button className="button mt-3 w-full" disabled={busy}>
        {busy ? 'Загружаем фото…' : 'Завершить уборку'}
      </button>
    </form>
  );
}
