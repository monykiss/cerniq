export const PUBLIC_PATHS = {
  home: '/',
  getStarted: '/get-started',
  demo: '/demo',
  pricing: '/pricing',
  roi: '/roi',
  developers: '/developers',
  changelog: '/changelog',
  whyCerniq: '/why-cerniq',
  compliance: '/compliance',
  almModules: '/alm/modules',
  contact: '/contact',
  status: '/status',
  terms: '/terms',
  privacy: '/privacy',
  security: '/security',
} as const;

export const PUBLIC_LEGAL_PATHS = [
  PUBLIC_PATHS.terms,
  PUBLIC_PATHS.privacy,
  PUBLIC_PATHS.security,
] as const;
