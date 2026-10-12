import { notFound } from 'next/navigation';

import { Footer } from '@/components/Footer';
import { LanguageSwitch, Mark } from '@/components/Header';
import { Photo } from '@/components/Photo';
import { copy } from '@/content/copy';
import { PHOTO_ORDER, PHOTOS } from '@/content/photos';
import { SITE_ORIGIN } from '@/content/site';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** Who made each photograph and map layer, and the licence it is used under. */
export function generateStaticParams(): { locale: string }[] {
  return [{ locale: 'bn' }, { locale: 'en' }];
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') return {};
  const t = copy[locale];
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: `${t.creditsTitle} — MedLiveBD`,
    description: t.creditsIntro,
    alternates: {
      canonical: `/${locale}/credits`,
      languages: { bn: '/bn/credits', en: '/en/credits' },
    },
  };
}

const MAP_SOURCES = [
  {
    name: 'Bangladesh country outline and divisions (ADM0, ADM1)',
    author: 'geoBoundaries (William & Mary geoLab); source Wikimedia Commons',
    source: 'https://www.geoboundaries.org/countryDownloads.html',
    licence: 'CC0 1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
  {
    name: 'Bangladesh district boundaries (ADM2)',
    author: 'Bangladesh Bureau of Statistics (BBS) and OCHA ROAP, via geoBoundaries',
    source: 'https://www.geoboundaries.org/countryDownloads.html',
    licence: 'CC BY 3.0 IGO',
    licenceUrl: 'https://creativecommons.org/licenses/by/3.0/igo/',
  },
] as const;

export default async function CreditsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') notFound();
  const t = copy[locale];
  return (
    <div className="company-page" lang={locale} id="top">
      <header className="site-header" data-scrolled="true">
        <div className="shell header-inner">
          <a className="brand-link" href={`/${locale}`} aria-label="MedLiveBD">
            <Mark priority />
          </a>
          <div className="header-actions">
            <LanguageSwitch locale={locale} path="/credits" />
          </div>
        </div>
      </header>
      <main id="main" className="shell legal credits">
        <a className="text-link" href={`/${locale}`}>
          <span aria-hidden="true">←</span> {t.creditsBack}
        </a>
        <h1>{t.creditsTitle}</h1>
        <p className="legal-updated">{t.creditsIntro}</p>
        <section>
          <h2>{t.creditsPhotos}</h2>
          <ul className="credit-list">
            {PHOTO_ORDER.map((key) => {
              const photo = PHOTOS[key];
              return (
                <li key={key}>
                  <Photo name={key} alt="" sizes="96px" className="credit-thumb" />
                  <span>
                    <strong lang="en">{photo.title}</strong>
                    <span lang="en">
                      {photo.author} ·{' '}
                      <a href={photo.source} rel="noreferrer">
                        {t.creditsSource}
                      </a>{' '}
                      ·{' '}
                      <a href={photo.licenceUrl} rel="noreferrer license">
                        {photo.licence}
                      </a>
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
        <section>
          <h2>{t.creditsMap}</h2>
          <ul className="credit-list credit-list-plain">
            {MAP_SOURCES.map((entry) => (
              <li key={entry.name}>
                <span>
                  <strong lang="en">{entry.name}</strong>
                  <span lang="en">
                    {entry.author} ·{' '}
                    <a href={entry.source} rel="noreferrer">
                      {t.creditsSource}
                    </a>{' '}
                    ·{' '}
                    <a href={entry.licenceUrl} rel="noreferrer license">
                      {entry.licence}
                    </a>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <Footer locale={locale} path="/credits" />
    </div>
  );
}
