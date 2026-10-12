import { SITE_ORIGIN } from '@/content/site';

import type { MetadataRoute } from 'next';

/** The two language editions, each naming the other (S-C-01, GR-06). */
export default function sitemap(): MetadataRoute.Sitemap {
  const languages = { bn: `${SITE_ORIGIN}/bn`, en: `${SITE_ORIGIN}/en` };
  return (['bn', 'en'] as const).map((locale) => ({
    url: `${SITE_ORIGIN}/${locale}`,
    changeFrequency: 'monthly',
    priority: locale === 'bn' ? 1 : 0.9,
    alternates: { languages },
  }));
}
