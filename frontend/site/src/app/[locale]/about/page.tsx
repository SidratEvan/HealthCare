import { notFound } from 'next/navigation';

import { Icon } from '@/components/icons';
import { DemoButton, EmailLink } from '@/components/links';
import { Reveal } from '@/components/motion';
import { Page } from '@/components/Page';
import { copy } from '@/content/copy';
import { founders } from '@/content/founders';
import { LOCALES, pageMetadata } from '@/content/site';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** About MedLiveBD: the people behind it and how to reach them (S-C-01, S-C-05). */
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
  return pageMetadata(
    locale,
    '/about',
    copy[locale].aboutPage.title,
    founders[locale].intro[0] ?? copy[locale].description,
  );
}

export default async function AboutPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') notFound();
  const c = copy[locale];
  const t = founders[locale];
  return (
    <Page locale={locale} page="about">
      <section className="page-intro page-intro-text" aria-labelledby="page-title">
        <div className="shell page-intro-inner">
          <p className="eyebrow">{c.aboutPage.label}</p>
          <h1 id="page-title" className="display-xl page-title">
            {t.heading}
          </h1>
          <div className="page-intro-side">
            {t.intro.map((paragraph) => (
              <p key={paragraph} className="lead">
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      </section>

      <section className="founders" aria-labelledby="founders-title">
        <div className="shell">
          <h2 id="founders-title" className="eyebrow">
            {t.label}
          </h2>
          <div className="founders-grid">
            {t.founders.map((person) => (
              <article key={person.key} className="founder" aria-labelledby={person.key}>
                <h3 id={person.key} className="display-m">
                  {person.name}
                </h3>
                <p className="person-role">{person.role}</p>
                <p className="person-focus">{person.focus}</p>
                <div className="founder-bio">
                  {person.bio.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
                <ul className="founder-contact">
                  {person.email === undefined ? null : (
                    <li>
                      <Icon name="mail" className="icon" />
                      <span className="sr-only">{t.email}: </span>
                      <a href={`mailto:${person.email}`}>{person.email}</a>
                    </li>
                  )}
                  <li>
                    <Icon name="phone" className="icon" />
                    <span className="sr-only">{t.phone}: </span>
                    <a href={`tel:${person.phone}`} dir="ltr">
                      {person.phoneDisplay}
                    </a>
                  </li>
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="statement" aria-labelledby="vision-title">
        <Reveal className="shell statement-inner">
          <p className="eyebrow eyebrow-teal">{t.visionLabel}</p>
          <h2 id="vision-title" className="display-l">
            {t.visionTitle}
          </h2>
          <p className="lead">{t.visionBody}</p>
          <p className="statement-close">{t.visionClose}</p>
        </Reveal>
      </section>

      <section className="cta-band" aria-labelledby="cta-title">
        <Reveal className="shell cta-band-inner">
          <h2 id="cta-title" className="display-l">
            {t.ctaTitle}
          </h2>
          <div className="cta-band-side">
            <p className="lead">{t.ctaBody}</p>
            <div className="actions">
              <DemoButton locale={locale} />
              <EmailLink />
            </div>
          </div>
        </Reveal>
      </section>
    </Page>
  );
}
