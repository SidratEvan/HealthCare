import { SITE_ORIGIN } from '@/content/site';

import type { MetadataRoute } from 'next';

/** Public company pages only; nothing here is private (S-C-01). */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/' }], sitemap: `${SITE_ORIGIN}/sitemap.xml` };
}
