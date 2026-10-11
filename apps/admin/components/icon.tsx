import type { SVGProps } from 'react';

const paths = {
  window: 'M4 3h16v18H4V3ZM12 3v18M4 12h16',
  sofa: 'M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M5 11H3v7h18v-7h-2M5 11v4h14v-4M5 18v3M19 18v3',
  office: 'M5 21V3h14v18M9 7h1M14 7h1M9 11h1M14 11h1M10 21v-5h4v5',
  tools: 'm4 20 8-8M14 3a6 6 0 0 0-2 9 6 6 0 0 0 9-2l-4 1-4-4 1-4ZM4 20l2-2',
  home: 'm3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9',
  sparkle: 'm12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3Z',
  user: 'M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  plus: 'M12 5v14M5 12h14',
  orders: 'M8 3H5v18h14V3h-3M9 3h6v4H9V3ZM8 12h8M8 16h6',
  people:
    'M16 21v-2a5 5 0 0 0-10 0v2M15 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM20 21v-2a5 5 0 0 0-3-4.6M18 3a4 4 0 0 1 0 8',
  chart: 'M4 20h16M6 16v-4M12 16V8M18 16V4',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'm6 6 12 12M6 18 18 6',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'M19 12H5m6-6-6 6 6 6',
  check: 'm5 12 4 4L19 6',
  eye: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
} as const;
export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
