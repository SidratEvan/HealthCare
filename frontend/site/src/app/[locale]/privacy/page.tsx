import { notFound } from 'next/navigation';

import { Footer, Mark } from '@/components/Landing';
import { copy } from '@/content/copy';
import { SITE_ORIGIN } from '@/content/site';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** What this website does with personal information, and nothing it does not (S-C-01). */
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
    title: `${t.privacyTitle} — MedLiveBD`,
    description: t.privacySections[0]?.body ?? t.description,
    alternates: {
      canonical: `/${locale}/privacy`,
      languages: { bn: '/bn/privacy', en: '/en/privacy' },
    },
  };
}

export default async function PrivacyPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') notFound();
  const t = copy[locale];
  return (
    <div className="company-page" lang={locale} id="top">
      <header className="site-header shell">
        <a className="brand-link" href={`/${locale}`} aria-label="MedLiveBD">
          <Mark />
        </a>
        <a
          className="language-link"
          href={`/${locale === 'bn' ? 'en' : 'bn'}/privacy`}
          lang={locale === 'bn' ? 'en' : 'bn'}
          hrefLang={locale === 'bn' ? 'en' : 'bn'}
        >
          {locale === 'bn' ? 'EN' : 'বাংলা'}
        </a>
      </header>
      <main id="main" className="shell legal">
        <a className="text-link" href={`/${locale}`}>
          ← {t.privacyBack}
        </a>
        <h1>{t.privacyTitle}</h1>
        <p className="legal-updated">{t.privacyUpdated}</p>
        {t.privacySections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            <p>{section.body}</p>
          </section>
        ))}
      </main>
      <Footer locale={locale} />
    </div>
  );
}
