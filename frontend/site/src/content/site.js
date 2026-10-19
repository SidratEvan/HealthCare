/**
 * Where the company site is served. `SITE_ORIGIN` overrides it for a preview
 * deployment, so canonical links never point a preview at itself.
 */
export const SITE_ORIGIN = (process.env['SITE_ORIGIN'] ?? 'https://medlivebd.com').replace(
  /\/$/,
  '',
);

export const LOCALES = [{ locale: 'bn' }, { locale: 'en' }];

/** One page's metadata in one language, naming its other edition (S-C-01, GR-06). */
export function pageMetadata(locale, path, title, description) {
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: {
      canonical: `/${locale}${path}`,
      languages: { bn: `/bn${path}`, en: `/en${path}`, 'x-default': `/bn${path}` },
    },
    openGraph: {
      type: 'website',
      siteName: 'MedLiveBD',
      url: `/${locale}${path}`,
      title,
      description,
      locale: locale === 'bn' ? 'bn_BD' : 'en_US',
      alternateLocale: locale === 'bn' ? 'en_US' : 'bn_BD',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}
