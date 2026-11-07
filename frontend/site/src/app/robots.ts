import { SITE_ORIGIN } from '@/content/site';

import type { MetadataRoute } from 'next';

/** Public company pages only; nothing here is private (S-C-01). */
/** Built once into a file, so a static host can serve it (`SITE_EXPORT`). */
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/' }], sitemap: `${SITE_ORIGIN}/sitemap.xml` };
}
