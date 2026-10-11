'use client';

import { useEffect, useRef, useState } from 'react';

import { contactEmail, copy, demoHref } from '@/content/copy';

import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

function Arrow({ diagonal = false }: { readonly diagonal?: boolean }): ReactNode {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="arrow">
      <path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'} />
    </svg>
  );
}

function Mark(): ReactNode {
  return (
    <img
      className="brand-logo"
      src="/brand/medlivebd-logo-light.webp"
      width="727"
      height="480"
      alt="MedLiveBD"
      fetchPriority="high"
    />
  );
}

/** Presentation diagram, not a client for real hospital data (FR-SEC-08). */
function Signal({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  return (
    <figure className="signal">
      <div className="signal-head">
        <span className="eyebrow">{t.signal}</span>
        <span className="signal-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
      <div className="signal-map">
        <svg className="signal-lines" viewBox="0 0 500 480" aria-hidden="true">
          <defs>
            <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" />
            </pattern>
          </defs>
          <rect width="500" height="480" fill="url(#dots)" className="dot-field" />
          <circle cx="250" cy="228" r="155" className="orbit" />
          <circle cx="250" cy="228" r="105" className="orbit" />
          <path
            className="connection"
            d="M250 226V78M250 226l-155-70M250 226l155-70M250 226l-115 122M250 226l115 122"
          />
          <path className="signal-trace" d="M95 156 250 226 250 78M250 226 365 348" />
          <g className="map-ring">
            <circle cx="250" cy="226" r="43" />
            <circle cx="250" cy="226" r="49" />
          </g>
          <g className="hospital-glyph">
            <path d="M228 247v-37h44v37m-30 0v-13h16v13m-26-26h7m22 0h7m-36 8h7m22 0h7m-22-24v-16m-8 8h16" />
          </g>
        </svg>
        <span className="map-label hub">{t.signalLabels[0]}</span>
        {t.signalLabels.slice(1).map((label, index) => (
          <span key={label} className={`map-label point point-${String(index)}`}>
            <span className="point-mark" aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>
      <figcaption>
        <span className="signal-caption-title">{t.signalTitle}</span>
        <span>{t.illustrative}</span>
      </figcaption>
    </figure>
  );
}

function Workflow({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  const [selected, setSelected] = useState(0);
  const feature = t.features[selected] ?? t.features[0];
  if (!feature) return null;
  return (
    <div className="workflow-explorer">
      <div className="workflow-select" role="group" aria-label={t.featureLabel}>
        {t.features.map((item, index) => (
          <button
            type="button"
            key={item.label}
            aria-pressed={index === selected}
            aria-controls="workflow-view"
            onClick={() => {
              setSelected(index);
            }}
          >
            <span>{item.label}</span>
            <Arrow />
          </button>
        ))}
      </div>
      <div id="workflow-view" className="workflow-view" aria-live="polite" aria-atomic="true">
        <div className="workflow-description">
          <span className="eyebrow">{t.example}</span>
          <h3>{feature.title}</h3>
          <p>{feature.body}</p>
        </div>
        <div className={`journey journey-${String(selected)}`} aria-hidden="true">
          <span className="journey-line" />
          {feature.stages.map((stage, index) => (
            <div className="journey-stage" key={stage}>
              <span className="stage-node">
                {index === 2 ? (
                  <svg viewBox="0 0 24 24">
                    <path d="m6 12 4 4 8-8" />
                  </svg>
                ) : (
                  <span />
                )}
              </span>
              <span>{stage}</span>
            </div>
          ))}
        </div>
        <p className="sr-only">{feature.stages.join(' → ')}</p>
        <div className="workflow-foot">
          <span className="small-glyph" aria-hidden="true">
            ↳
          </span>
          <p>{feature.detail}</p>
        </div>
      </div>
      <p className="workflow-caption">{t.exampleCaption}</p>
    </div>
  );
}

export function Landing({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const navItems = ['platform', 'hospitals', 'about', 'contact'];

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('keydown', close);
    };
  }, [menuOpen]);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 761px)');
    const closeOnDesktop = (): void => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => {
      desktop.removeEventListener('change', closeOnDesktop);
    };
  }, []);

  return (
    <div className="company-page" lang={locale} id="top">
      <a className="skip-link" href="#main">
        {t.skip}
      </a>
      <header className="site-header shell">
        <a className="brand-link" href={`/${locale}`} aria-label="MedLiveBD">
          <Mark />
        </a>
        <nav className="desktop-nav" aria-label={t.menu}>
          {t.nav.map((label, index) => (
            <a key={label} href={`#${navItems[index] ?? 'contact'}`}>
              {label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <a
            className="language-link"
            href={`/${locale === 'bn' ? 'en' : 'bn'}`}
            lang={locale === 'bn' ? 'en' : 'bn'}
            hrefLang={locale === 'bn' ? 'en' : 'bn'}
            aria-label={locale === 'bn' ? 'Read in English' : 'বাংলায় পড়ুন'}
          >
            {locale === 'bn' ? 'EN' : 'বাংলা'}
          </a>
          <a className="header-contact" href={demoHref}>
            {t.demo}
            <Arrow diagonal />
          </a>
          <button
            className="menu-toggle"
            type="button"
            ref={menuButton}
            onClick={() => {
              setMenuOpen(!menuOpen);
            }}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            aria-label={menuOpen ? t.close : t.menu}
          >
            <span />
            <span />
          </button>
        </div>
        <nav id="mobile-navigation" className="mobile-nav" aria-label={t.menu} hidden={!menuOpen}>
          {t.nav.map((label, index) => (
            <a
              key={label}
              href={`#${navItems[index] ?? 'contact'}`}
              onClick={() => {
                setMenuOpen(false);
              }}
            >
              {label}
              <Arrow />
            </a>
          ))}
          <a href={demoHref}>
            {t.demo}
            <Arrow diagonal />
          </a>
        </nav>
      </header>
      <main id="main">
        <section className="hero shell" aria-labelledby="hero-heading">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="status-dot" aria-hidden="true" />
              {t.eyebrow}
            </p>
            <h1 id="hero-heading">
              {t.hero.map((line, index) => (
                <span key={line} className={index === 1 ? 'hero-accent' : undefined}>
                  {line}
                </span>
              ))}
            </h1>
            <p className="hero-lead">{t.lead}</p>
            <div className="hero-links">
              <a className="button button-dark" href={demoHref}>
                {t.demo}
                <Arrow diagonal />
              </a>
              <a className="text-link" href="#platform">
                {t.explore}
                <Arrow />
              </a>
            </div>
            <p className="hero-foot">
              <span className="fine-line" aria-hidden="true" />
              {t.heroFoot}
            </p>
          </div>
          <Signal locale={locale} />
        </section>
        <div className="principle-strip shell">
          {t.strip.map((line, index) => (
            <div key={line}>
              <span className="strip-symbol" aria-hidden="true">
                {['↗', '⊞', '↔'][index]}
              </span>
              {line}
            </div>
          ))}
        </div>
        <section
          className="intro shell section-space"
          id="platform"
          aria-labelledby="intro-heading"
        >
          <p className="eyebrow section-label">{t.introLabel}</p>
          <div>
            <h2 id="intro-heading">{t.introTitle}</h2>
            <p className="body-large">{t.intro}</p>
            <p className="intro-note">{t.introSmall}</p>
          </div>
        </section>
        <section className="operations" aria-labelledby="flow-heading">
          <div className="shell section-space">
            <div className="operations-heading">
              <div>
                <p className="eyebrow">{t.flowLabel}</p>
                <h2 id="flow-heading">{t.flowTitle}</h2>
              </div>
              <p>{t.flowBody}</p>
            </div>
            <Workflow locale={locale} />
          </div>
        </section>
        <section
          className="hospital-section shell section-space"
          id="hospitals"
          aria-labelledby="hospital-heading"
        >
          <div className="hospital-heading">
            <p className="eyebrow">{t.hospitalLabel}</p>
            <h2 id="hospital-heading">{t.hospitalTitle}</h2>
            <p>{t.hospitalBody}</p>
            <a className="text-link" href={demoHref}>
              {t.demo}
              <Arrow diagonal />
            </a>
          </div>
          <ol className="onboarding">
            {t.steps.map((step, index) => (
              <li key={step.title}>
                <span className="step-number" aria-hidden="true">
                  {locale === 'bn' ? ['০১', '০২', '০৩'][index] : ['01', '02', '03'][index]}
                </span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className="advantages" aria-labelledby="advantages-heading">
          <div className="shell section-space">
            <div className="advantages-heading">
              <p className="eyebrow">{t.advantagesLabel}</p>
              <h2 id="advantages-heading">{t.advantagesTitle}</h2>
            </div>
            <div className="advantage-list">
              {t.advantages.map((item, index) => (
                <article key={item.title}>
                  <span className="advantage-icon" aria-hidden="true">
                    <svg viewBox="0 0 48 48">
                      {index === 0 ? (
                        <>
                          <path d="M10 14h28v22H10zM17 8v12m14-12v12M17 28h14" />
                          <circle cx="33" cy="34" r="8" />
                          <path d="m30 34 2 2 4-5" />
                        </>
                      ) : index === 1 ? (
                        <>
                          <circle cx="24" cy="24" r="6" />
                          <circle cx="24" cy="7" r="3" />
                          <circle cx="8" cy="35" r="3" />
                          <circle cx="40" cy="35" r="3" />
                          <path d="M24 10v8M11 33l8-6m10 0 8 6" />
                        </>
                      ) : (
                        <>
                          <path d="M10 9h28v30H10zM17 17h14m-14 7h14m-14 7h7" />
                          <path d="m29 34 4 4 8-10" />
                        </>
                      )}
                    </svg>
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="about shell section-space" id="about" aria-labelledby="about-heading">
          <p className="eyebrow section-label">{t.aboutLabel}</p>
          <div>
            <h2 id="about-heading">{t.aboutTitle}</h2>
            <p className="body-large">{t.aboutBody}</p>
            <p className="about-signature">{t.aboutFoot}</p>
          </div>
        </section>
        <section className="contact-section" id="contact" aria-labelledby="contact-heading">
          <div className="shell section-space">
            <div className="contact-top">
              <p className="eyebrow">{t.contactLabel}</p>
              <span className="contact-orbit" aria-hidden="true">
                <Arrow diagonal />
              </span>
            </div>
            <div className="contact-grid">
              <div>
                <h2 id="contact-heading">{t.contactTitle}</h2>
                <p>{t.contactBody}</p>
                <a className="button button-mint" href={demoHref}>
                  {t.demo}
                  <Arrow diagonal />
                </a>
              </div>
              <div className="contact-email">
                <span>{t.emailLabel}</span>
                <a href={`mailto:${contactEmail}`}>
                  {contactEmail}
                  <Arrow diagonal />
                </a>
                <p>{t.contactNote}</p>
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer className="site-footer shell">
        <div>
          <Mark />
          <p>{t.footer}</p>
        </div>
        <span>
          ©{' '}
          {new Date()
            .getFullYear()
            .toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-US', { useGrouping: false })}{' '}
          {t.copyright}
        </span>
        <a href="#top">
          {t.backTop}
          <Arrow diagonal />
        </a>
      </footer>
    </div>
  );
}
