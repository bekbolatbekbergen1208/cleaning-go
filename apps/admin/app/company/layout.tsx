import type { ReactNode } from 'react';

export default function CompanyLayout({ children }: { children: ReactNode }) {
  return <div className="company-mobile-shell">{children}</div>;
}
