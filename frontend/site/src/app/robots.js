import { SITE_ORIGIN } from '@/content/site';

/** Public company pages only; nothing here is private (S-C-01). */
/** Built once into a file, so a static host can serve it (`SITE_EXPORT`). */
export const dynamic = 'force-static';

export default function robots() {
  return { rules: [{ userAgent: '*', allow: '/' }], sitemap: `${SITE_ORIGIN}/sitemap.xml` };
}
