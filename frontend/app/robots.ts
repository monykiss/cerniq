import type { MetadataRoute } from 'next';
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/admin/', '/portal/', '/api/', '/auth/'] },
    sitemap: 'https://cerniq.io/sitemap.xml',
  };
}
