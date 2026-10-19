import { notFound } from 'next/navigation';

import { ordinal } from '@/components/format';
import { DemoButton, EmailLink } from '@/components/links';
import { Reveal } from '@/components/motion';
import { Page } from '@/components/Page';
import { DriftImage } from '@/components/scroll';
import { copy } from '@/content/copy';
import { LOCALES, pageMetadata } from '@/content/site';

/**
 * For Hospitals (S-C-02): the hospital-facing destination of the hero's first
 * door — a short business case and one action, a private demonstration. A page
 * of its own, never an anchor on the homepage; the staff console's password-
 * less demo is never linked from here (FR-SEC-08).
 */
export function generateStaticParams() {
  return LOCALES;
}

export async function generateMetadata({ params }) {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') return {};
  const t = copy[locale].hospitalsPage;
  return pageMetadata(locale, '/hospitals', t.title, t.description);
}

export default async function HospitalsPage({ params }) {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') notFound();
  const t = copy[locale].hospitalsPage;
  return (
    <Page locale={locale} page="hospitals">
      <section className="page-intro" aria-labelledby="page-title">
        <div className="shell page-intro-inner">
          <p className="eyebrow eyebrow-blue">{t.label}</p>
          <h1 id="page-title" className="display-xl page-title">
            {t.heading}
          </h1>
          <div className="page-intro-side">
            <p className="lead">{t.lead}</p>
            <div className="actions">
              <DemoButton locale={locale} />
              <EmailLink />
            </div>
          </div>
        </div>
        <DriftImage
          name="hospital-operations"
          alt={t.alt}
          priority
          sizes="100vw"
          className="page-band"
        />
      </section>

      <section className="hp-section" aria-labelledby="capabilities-title">
        <div className="shell">
          <Reveal className="hp-head">
            <h2 id="capabilities-title" className="display-m">
              {t.capabilitiesTitle}
            </h2>
          </Reveal>
          <ol className="hp-grid">
            {t.capabilities.map(([title, body], index) => (
              <li key={title}>
                <span className="capability-index" aria-hidden="true">
                  {ordinal(index + 1, locale)}
                </span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="hp-section hp-steps" aria-labelledby="steps-title">
        <div className="shell">
          <Reveal className="hp-head">
            <h2 id="steps-title" className="display-m">
              {t.stepsTitle}
            </h2>
          </Reveal>
          <ol className="journey journey-wide">
            {t.steps.map(([title, body], index) => (
              <li key={title}>
                <span className="journey-step" aria-hidden="true">
                  {ordinal(index + 1, locale)}
                </span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="hp-section hp-trust" aria-labelledby="trust-title">
        <div className="shell">
          <Reveal className="hp-head">
            <h2 id="trust-title" className="display-m">
              {t.trustTitle}
            </h2>
          </Reveal>
          <ul className="principles">
            {t.trust.map(([title, body]) => (
              <li key={title}>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ul>
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
            <p className="fine-print">{t.ctaBody}</p>
          </div>
        </Reveal>
      </section>
    </Page>
  );
}
