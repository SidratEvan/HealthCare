import { SITE_ORIGIN } from '@/content/site';

import type { MetadataRoute } from 'next';

/** Each page in both languages, each naming the other (S-C-01, GR-06). */
/** Built once into a file, so a static host can serve it (`SITE_EXPORT`). */
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return (['', '/privacy', '/credits'] as const).flatMap((path) => {
    const languages = { bn: `${SITE_ORIGIN}/bn${path}`, en: `${SITE_ORIGIN}/en${path}` };
    return (['bn', 'en'] as const).map((locale) => ({
      url: `${SITE_ORIGIN}/${locale}${path}`,
      changeFrequency: 'monthly' as const,
      priority: path === '' ? (locale === 'bn' ? 1 : 0.9) : 0.3,
      alternates: { languages },
    }));
  });
}
