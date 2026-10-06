'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function VarReportsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/alm/var'); }, [router]);
  return null;
}
