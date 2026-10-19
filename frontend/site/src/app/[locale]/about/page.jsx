import { notFound } from 'next/navigation';

import { Icon } from '@/components/icons';
import { DemoButton, EmailLink } from '@/components/links';
import { Reveal } from '@/components/motion';
import { Page } from '@/components/Page';
import { copy } from '@/content/copy';
import { founders } from '@/content/founders';
import { LOCALES, pageMetadata } from '@/content/site';

/** About MedLiveBD: the founders and how to reach them — nothing more (S-C-01, S-C-05). */
export function generateStaticParams() {
  return LOCALES;
}

export async function generateMetadata({ params }) {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') return {};
  return pageMetadata(
    locale,
    '/about',
    copy[locale].aboutPage.title,
    `${founders[locale].heading} ${founders[locale].founders.map((f) => f.name).join(', ')}.`,
  );
}

export default async function AboutPage({ params }) {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') notFound();
  const c = copy[locale];
  const t = founders[locale];
  return (
    <Page locale={locale} page="about">
      <section className="page-intro page-intro-text founders" aria-labelledby="page-title">
        <div className="shell">
          <p className="eyebrow">{c.aboutPage.label}</p>
          <h1 id="page-title" className="display-xl page-title">
            {t.heading}
          </h1>
          <div className="founders-grid">
            {t.founders.map((person) => (
              <article key={person.key} className="founder" aria-labelledby={person.key}>
                <h2 id={person.key} className="display-m">
                  {person.name}
                </h2>
                <p className="person-role">{person.title}</p>
                <ul className="founder-contact">
                  <li>
                    <Icon name="mail" className="icon" />
                    <span className="sr-only">{t.email}: </span>
                    <a href={`mailto:${person.email}`}>{person.email}</a>
                  </li>
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

      <section className="cta-band" aria-labelledby="cta-title">
        <Reveal className="shell cta-band-inner">
          <h2 id="cta-title" className="display-l">
            {t.ctaTitle}
          </h2>
          <div className="cta-band-side">
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
