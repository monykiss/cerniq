import type { ReactNode } from 'react';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <div className="cerniq-dashboard-theme cerniq-dashboard-page">{children}</div>;
}
