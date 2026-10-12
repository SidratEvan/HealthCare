import { notFound } from 'next/navigation';

import { Page } from '@/components/Page';
import { copy } from '@/content/copy';
import { LOCALES, pageMetadata } from '@/content/site';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** What this website does with personal information, and nothing it does not (S-C-01). */
export function generateStaticParams(): { locale: string }[] {
  return LOCALES;
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') return {};
  const t = copy[locale];
  return pageMetadata(
    locale,
    '/privacy',
    `${t.privacyTitle} — MedLiveBD`,
    t.privacySections[0]?.body ?? t.description,
  );
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
    <Page locale={locale} page="privacy">
      <article className="shell legal">
        <a className="text-link" href={`/${locale}`}>
          <span aria-hidden="true">←</span> {t.back}
        </a>
        <h1 className="display-m">{t.privacyTitle}</h1>
        <p className="legal-updated">{t.privacyUpdated}</p>
        {t.privacySections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            <p>{section.body}</p>
          </section>
        ))}
      </article>
    </Page>
  );
}
