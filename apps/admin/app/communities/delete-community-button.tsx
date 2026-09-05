'use client';

export function DeleteCommunityButton({ name }: { name: string }) {
  return <button
    type="submit"
    className="text-sm font-bold text-red-600"
    onClick={(event) => {
      if (!window.confirm(`Удалить сообщество «${name}»? Компании и клинеры потеряют доступ к нему.`)) {
        event.preventDefault();
      }
    }}
  >
    Удалить
  </button>;
}
