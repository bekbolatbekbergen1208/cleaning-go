// Human-readable Russian labels for database codes shown in the UI.

export const orderStatusNames: Record<string, string> = {
  created: 'Создан',
  searching: 'Ожидает исполнителя',
  offered: 'Цена предложена',
  accepted: 'Принят',
  on_the_way: 'В пути',
  arrived: 'На месте',
  in_progress: 'Уборка идёт',
  completed_by_cleaner: 'Ожидает подтверждения',
  completed: 'Завершён',
  cancelled: 'Отменён',
  disputed: 'Спор',
};

export const roleNames: Record<string, string> = {
  client: 'Клиент',
  cleaner: 'Клинер',
  company_cleaner: 'Клинер компании',
  company_owner: 'Компания',
  admin: 'Администратор',
};

export const accountStatusNames: Record<string, string> = {
  active: 'Активен',
  blocked: 'Заблокирован',
};

export const verificationNames: Record<string, string> = {
  pending: 'На проверке',
  approved: 'Одобрена',
  rejected: 'Отклонена',
  blocked: 'Заблокирована',
};

export const bonusOperationNames: Record<string, string> = {
  welcome_grant: 'Приветственный бонус',
  referral_grant: 'Бонус за приглашение',
  order_use: 'Оплата бонусами',
  order_refund: 'Возврат бонусов',
  admin_adjustment: 'Корректировка',
};

export const label = (names: Record<string, string>, code?: string | null) =>
  code ? (names[code] ?? code) : '';

// Notification texts are generated in SQL and may contain raw status codes,
// for example "Новый статус: in_progress".
export function humanizeCodes(text?: string | null) {
  if (!text) return '';
  return text.replace(/\b[a-z]+(?:_[a-z]+)*\b/g, (code) => orderStatusNames[code] ?? code);
}
