'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const INTERNAL_ROUTE_PREFIXES = ['/admin'];
const CUSTOMER_THEME_CLASS = 'cerniq-customer-theme';

function isInternalRoute(pathname: string | null) {
  if (!pathname) {
    return false;
  }

  return INTERNAL_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default function ThemeRouteController() {
  const pathname = usePathname();

  useEffect(() => {
    const shouldUseCustomerTheme = !isInternalRoute(pathname);
    document.body.classList.toggle(CUSTOMER_THEME_CLASS, shouldUseCustomerTheme);

    return () => {
      document.body.classList.remove(CUSTOMER_THEME_CLASS);
    };
  }, [pathname]);

  return null;
}
