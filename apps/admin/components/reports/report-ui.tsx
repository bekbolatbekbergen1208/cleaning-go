import Link from 'next/link';
import { periods, type Bucket, type PeriodKey } from '../../lib/reports';

export function PeriodTabs({ base, period, extra }: { base: string; period: PeriodKey; extra?: React.ReactNode }) {
  return (
    <div className="report-toolbar">
      <nav aria-label="Период отчёта" className="report-periods">
        {periods.map(([key, label]) => (
          <Link key={key} href={`${base}?period=${key}`} aria-current={period === key ? 'page' : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      {extra}
    </div>
  );
}

export function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string | undefined }) {
  return (
    <div className="report-metric">
      <p>{label}</p>
      <b>{value}</b>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function niceMax(max: number) {
  if (max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 2.5, 5, 10].map((n) => n * power).find((n) => n >= max)!;
}

// Single-series column chart. HTML/CSS (not a scaled SVG) so labels keep their
// size on phones. Every column is focusable and shows its value on hover/focus.
export function BarChart({
  title,
  summary,
  buckets,
  format,
}: {
  title: string;
  summary?: string;
  buckets: Bucket[];
  format: (value: number) => string;
}) {
  const max = niceMax(Math.max(0, ...buckets.map((b) => b.value)));
  const ticks = [max, max / 2, 0];
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 7));
  const empty = buckets.every((b) => b.value === 0);
  return (
    <figure className="report-chart">
      <figcaption>
        <span>{title}</span>
        {summary && <b>{summary}</b>}
      </figcaption>
      {empty ? (
        <p className="report-empty">За выбранный период данных нет.</p>
      ) : (
        <>
          <div className="report-plot">
            <div className="report-grid" aria-hidden="true">
              {ticks.map((tick) => (
                <div key={tick} style={{ bottom: `${(tick / max) * 100}%` }}>
                  <span>{format(tick)}</span>
                </div>
              ))}
            </div>
            <ol className="report-bars">
              {buckets.map((bucket) => (
                <li key={bucket.key} tabIndex={0} aria-label={`${bucket.label}: ${format(bucket.value)}`}>
                  <i style={{ height: `${(bucket.value / max) * 100}%` }} />
                  <span className="report-tip" role="tooltip">
                    <b>{format(bucket.value)}</b>
                    {bucket.label}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="report-x" aria-hidden="true">
            {buckets.map((bucket, index) => (
              <span key={bucket.key}>{index % labelEvery === 0 ? bucket.label : ''}</span>
            ))}
          </div>
        </>
      )}
    </figure>
  );
}

// Parts of a whole as labelled horizontal bars (one hue; text carries the meaning).
export function Breakdown({ title, items, format }: { title: string; items: { label: string; value: number }[]; format?: (v: number) => string }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <section className="report-card">
      <h2>{title}</h2>
      {total ? (
        <ul className="report-breakdown">
          {items.map((item) => (
            <li key={item.label}>
              <div>
                <span>{item.label}</span>
                <b>
                  {format ? format(item.value) : item.value}
                  <small> · {Math.round((item.value / total) * 100)}%</small>
                </b>
              </div>
              <i style={{ width: `${(item.value / max) * 100}%` }} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="report-empty">Нет данных за период.</p>
      )}
    </section>
  );
}
