export type Locale = 'ru' | 'kk' | 'en';
const messages = { ru: { home: 'Главная', orders: 'Заказы', profile: 'Профиль' }, kk: { home: 'Басты бет', orders: 'Тапсырыстар', profile: 'Профиль' }, en: { home: 'Home', orders: 'Orders', profile: 'Profile' } } as const;
export function t(key: keyof typeof messages.ru, locale: Locale = 'ru') { return messages[locale][key]; }
