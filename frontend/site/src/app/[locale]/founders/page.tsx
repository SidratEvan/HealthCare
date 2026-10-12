import { notFound } from 'next/navigation';

import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { Icon } from '@/components/icons';
import { MotionProvider } from '@/components/motion';
import { contactEmail, copy, demoHref } from '@/content/copy';
import { founders } from '@/content/founders';
import { SITE_ORIGIN } from '@/content/site';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** The people behind MedLiveBD and how to reach them (S-C-01, S-C-05). */
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
  const t = founders[locale];
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: t.title,
    description: t.intro[0],
    alternates: {
      canonical: `/${locale}/founders`,
      languages: { bn: '/bn/founders', en: '/en/founders' },
    },
  };
}

export default async function FoundersPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') notFound();
  const t = founders[locale];
  return (
    <MotionProvider>
      <div className="company-page cinematic-page founders-page" lang={locale} id="top">
        <a className="skip-link" href="#main">
          {copy[locale].skip}
        </a>
        <Header locale={locale} page="founders" />
        <main id="main">
          <section className="founders-intro" aria-labelledby="founders-title">
            <div className="shell">
              <p className="pulse-kicker">
                <span className="signal-dot" />
                {t.label}
              </p>
              <h1 id="founders-title">{t.heading}</h1>
              <div className="founders-lead">
                {t.intro.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </div>
          </section>
          <section className="founders-people" aria-label={t.label}>
            <div className="shell founders-grid">
              {t.founders.map((person) => (
                <article key={person.key} className="founder" aria-labelledby={person.key}>
                  <div className="founder-head">
                    <span className="founder-mark" aria-hidden="true">
                      {person.badge}
                    </span>
                    <div>
                      <h2 id={person.key}>{person.name}</h2>
                      <p className="founder-role">{person.role}</p>
                    </div>
                  </div>
                  <p className="founder-focus">{person.focus}</p>
                  <div className="founder-bio">
                    {person.bio.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                  <dl className="founder-contact">
                    <div>
                      <dt>{t.email}</dt>
                      <dd>
                        <a href={`mailto:${person.email}`}>{person.email}</a>
                      </dd>
                    </div>
                    <div>
                      <dt>{t.phone}</dt>
                      <dd>
                        <a href={`tel:${person.phone}`} dir="ltr">
                          {person.phoneDisplay}
                        </a>
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </section>
          <section className="founders-vision" aria-labelledby="vision-title">
            <div className="shell founders-vision-inner">
              <div>
                <p className="pulse-kicker">{t.visionLabel}</p>
                <h2 id="vision-title">{t.visionTitle}</h2>
              </div>
              <div className="founders-vision-copy">
                <p>{t.visionBody}</p>
                <p className="founders-vision-close">{t.visionClose}</p>
                <div className="founders-cta">
                  <h3>{t.ctaTitle}</h3>
                  <p>{t.ctaBody}</p>
                  <div className="pulse-actions">
                    <a href={demoHref} className="button button-primary">
                      {copy[locale].demo}
                      <Icon name="diagonal" className="arrow" />
                    </a>
                    <a className="pulse-text-link" href={`mailto:${contactEmail}`}>
                      {contactEmail}
                      <Icon name="diagonal" className="arrow" />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>
        <Footer locale={locale} path="/founders" />
      </div>
    </MotionProvider>
  );
}
