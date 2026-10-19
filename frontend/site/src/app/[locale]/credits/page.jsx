import { notFound } from 'next/navigation';

import { CampaignImage } from '@/components/CampaignImage';
import { Page } from '@/components/Page';
import { copy } from '@/content/copy';
import { LOCALES, pageMetadata } from '@/content/site';

/** Where each image and map layer came from, and the licence it is used under. */
export function generateStaticParams() {
  return LOCALES;
}

export async function generateMetadata({ params }) {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') return {};
  const t = copy[locale];
  return pageMetadata(locale, '/credits', `${t.creditsTitle} — MedLiveBD`, t.creditsIntro);
}

const MAP_SOURCES = [
  {
    name: 'Bangladesh country outline and divisions (ADM0, ADM1)',
    author: 'geoBoundaries (William & Mary geoLab); source Wikimedia Commons',
    source: 'https://www.geoboundaries.org/countryDownloads.html',
    licence: 'CC0 1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
];

export default async function CreditsPage({ params }) {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') notFound();
  const t = copy[locale];
  return (
    <Page locale={locale} page="credits">
      <article className="shell legal">
        <a className="text-link" href={`/${locale}`}>
          <span aria-hidden="true">←</span> {t.back}
        </a>
        <h1 className="display-m">{t.creditsTitle}</h1>
        <p className="legal-updated">{t.creditsIntro}</p>
        <section>
          <h2>{t.assetsTitle}</h2>
          <p>{t.assetsIntro}</p>
          <ul className="credit-list">
            {['hero-collaboration', 'team', 'patient', 'atmosphere', 'hospital-operations'].map(
              (key, index) => (
                <li key={key}>
                  <CampaignImage name={key} alt="" sizes="120px" className="credit-thumb" />
                  <span>
                    <strong>{t.assetNames[index]}</strong>
                    <a href={`/campaign/${key}-1920.webp`}>{t.creditsSource}</a>
                  </span>
                </li>
              ),
            )}
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
      </article>
    </Page>
  );
}
