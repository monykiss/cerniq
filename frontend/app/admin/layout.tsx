import { ErrorBoundary } from '@/components/ErrorBoundary';
import AdminSessionBoundary from '@/components/admin/AdminSessionBoundary';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

function isAdminEnabled(): boolean {
  const raw = (
    process.env.ENABLE_ADMIN ||
    process.env.NEXT_PUBLIC_ENABLE_ADMIN ||
    ''
  )
    .trim()
    .toLowerCase();

  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') {
    return true;
  }

  return process.env.NODE_ENV !== 'production';
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isAdminEnabled()) {
    notFound();
  }

  return (
    <ErrorBoundary context="admin">
      <AdminSessionBoundary>{children}</AdminSessionBoundary>
    </ErrorBoundary>
  );
}
