// Shared helpers for the company and admin reports.

export const REPORT_TZ = 'Asia/Almaty';
export const periods = [
  ['7', '7 дней'],
  ['30', '30 дней'],
  ['90', '90 дней'],
  ['all', 'Всё время'],
] as const;
export type PeriodKey = (typeof periods)[number][0];

export function parsePeriod(value?: string): PeriodKey {
  return (periods.find(([key]) => key === value)?.[0] ?? '30') as PeriodKey;
}

export function periodStart(period: PeriodKey, now = Date.now()) {
  return period === 'all' ? null : new Date(now - Number(period) * 86400000);
}

export const money = (minor: number) =>
  `${Math.round(minor / 100).toLocaleString('ru-RU')} ₸`;

export const percent = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : '—';

const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayLabel = new Intl.DateTimeFormat('ru-RU', { timeZone: REPORT_TZ, day: 'numeric', month: 'short' });
const monthLabel = new Intl.DateTimeFormat('ru-RU', { timeZone: REPORT_TZ, month: 'short', year: '2-digit' });

export type Bucket = { key: string; label: string; value: number; count: number };

// Days for 7/30, weeks for 90, months for "all time"; empty buckets included so
// gaps read as zero instead of disappearing.
export function buildBuckets<T>(
  rows: T[],
  date: (row: T) => string | null | undefined,
  value: (row: T) => number,
  period: PeriodKey,
  now = Date.now(),
): Bucket[] {
  const unit = period === 'all' ? 'month' : period === '90' ? 'week' : 'day';
  const keyOf = (d: Date) => {
    const [y = 1970, m = 1, day = 1] = dayKey.format(d).split('-').map(Number);
    if (unit === 'month') return `${y}-${String(m).padStart(2, '0')}`;
    if (unit === 'week') {
      const utc = Date.UTC(y, m - 1, day);
      const monday = utc - ((new Date(utc).getUTCDay() + 6) % 7) * 86400000;
      return new Date(monday).toISOString().slice(0, 10);
    }
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  const buckets = new Map<string, Bucket>();
  const add = (d: Date) => {
    const key = keyOf(d);
    if (!buckets.has(key)) {
      const label = unit === 'month' ? monthLabel.format(d) : unit === 'week' ? `с ${dayLabel.format(new Date(`${key}T12:00:00Z`))}` : dayLabel.format(d);
      buckets.set(key, { key, label, value: 0, count: 0 });
    }
  };
  const dates = rows.map(date).filter(Boolean).map((d) => new Date(d!));
  const first =
    period === 'all'
      ? dates.reduce((min, d) => (d < min ? d : min), new Date(now))
      : new Date(now - (Number(period) - 1) * 86400000);
  const step = unit === 'day' ? 86400000 : unit === 'week' ? 7 * 86400000 : 28 * 86400000;
  for (let t = first.getTime(); t <= now; t += step) add(new Date(t));
  add(new Date(now));
  for (const row of rows) {
    const d = date(row);
    if (!d) continue;
    const at = new Date(d);
    add(at);
    const bucket = buckets.get(keyOf(at))!;
    bucket.value += value(row);
    bucket.count += 1;
  }
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// CSV for Excel: UTF-8 BOM, semicolons, formula-injection safe cells.
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (value: string | number | null | undefined) => {
    let text = value == null ? '' : String(value);
    // Only free text can carry a formula; numbers (even negative) stay numbers.
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `﻿${[header, ...rows].map((row) => row.map(cell).join(';')).join('\r\n')}\r\n`;
}
