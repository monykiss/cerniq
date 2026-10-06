/**
 * Shared frontend constants
 */

/** Base URL for the Node.js API */
export const API_BASE = process.env.NEXT_PUBLIC_NODE_API_URL || '';

/** Supported locales */
export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

/** Default application locale */
export const DEFAULT_LOCALE: Locale = 'en';

/** Cerniq support email */
export const CERNIQ_SUPPORT_EMAIL = 'support@cerniq.io';

/** Cerniq sales email */
export const CERNIQ_SALES_EMAIL = 'hello@cerniq.io';

/** Max file upload size in bytes (10 MB) */
export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

/** Pagination defaults */
export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
