'use client';

import { useEffect, useRef, useState } from 'react';

import { contactEmail, copy, demoHref } from '@/content/copy';

import type { Feature, Locale } from '@/content/copy';
import type { ReactNode, RefObject } from 'react';

function Arrow({ diagonal = false }: { readonly diagonal?: boolean }): ReactNode {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="arrow">
      <path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'} />
    </svg>
  );
}

export function Mark(): ReactNode {
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

/** A captured screen of the real product on seeded demonstration data (FR-SEC-08, FR-DEM-07). */
function screen(key: Feature['key'], locale: Locale): string {
  return `/screens/${key}-${locale}.webp`;
}

/** A console screen in a plain browser frame. */
function Browser({
  src,
  alt,
  eager = false,
}: {
  readonly src: string;
  readonly alt: string;
  readonly eager?: boolean;
}): ReactNode {
  return (
    <div className="browser">
      <div className="browser-bar" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <img
        src={src}
        alt={alt}
        width="1440"
        height="900"
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
    </div>
  );
}

/** The patient app in a phone frame. */
function Phone({
  src,
  alt,
  eager = false,
}: {
  readonly src: string;
  readonly alt: string;
  readonly eager?: boolean;
}): ReactNode {
  return (
    <div className="phone">
      <img
        src={src}
        alt={alt}
        width="390"
        height="844"
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
    </div>
  );
}

function Stage({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  return (
    <figure className="stage">
      <div className="stage-frames">
        <Browser src={screen('reception', locale)} alt={t.heroAltConsole} eager />
        <div className="stage-phone">
          <Phone src={screen('patient', locale)} alt={t.heroAltPhone} eager />
          <span className="live-badge" aria-hidden="true">
            <span className="live-dot" />
            {t.liveBadge}
          </span>
        </div>
      </div>
      <figcaption>{t.illustrative}</figcaption>
    </figure>
  );
}

function Workflow({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  const [selected, setSelected] = useState(0);
  const feature = t.features[selected] ?? t.features[0];
  if (!feature) return null;
  return (
    <div className="workflow">
      <div className="workflow-select" role="group" aria-label={t.featureLabel}>
        {t.features.map((item, index) => (
          <button
            type="button"
            key={item.key}
            aria-pressed={index === selected}
            aria-controls="workflow-view"
            onClick={() => {
              setSelected(index);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div id="workflow-view" className="workflow-view">
        <div className="workflow-text" aria-live="polite" aria-atomic="true">
          <h3>{feature.title}</h3>
          <p>{feature.body}</p>
          <p className="workflow-detail">
            <span className="live-dot" aria-hidden="true" />
            {feature.detail}
          </p>
        </div>
        <div className={`workflow-screen screen-${feature.key}`} key={feature.key}>
          {feature.key === 'patient' ? (
            <Phone src={screen(feature.key, locale)} alt={feature.alt} />
          ) : (
            <Browser src={screen(feature.key, locale)} alt={feature.alt} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Sections rise into place once, as they are reached; nothing hides without script. */
function useReveal(root: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const page = root.current;
    if (page === null) return;
    page.classList.add('reveal-ready');
    const targets = page.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      targets.forEach((target) => target.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    targets.forEach((target) => observer.observe(target));
    return () => {
      observer.disconnect();
    };
  }, [root]);
}

export function Footer({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  const other = locale === 'bn' ? 'en' : 'bn';
  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div className="footer-brand">
          <Mark />
          <p>{t.footer}</p>
          <p className="footer-tagline">{t.aboutFoot}</p>
        </div>
        <nav aria-label={t.footerCompany}>
          <h2>{t.footerCompany}</h2>
          <a href={`/${locale}#platform`}>{t.nav[0]}</a>
          <a href={`/${locale}#hospitals`}>{t.nav[1]}</a>
          <a href={`/${locale}#about`}>{t.nav[2]}</a>
          <a href={`/${locale}/privacy`}>{t.privacy}</a>
        </nav>
        <div>
          <h2>{t.footerContact}</h2>
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
          <a href={demoHref}>{t.demo}</a>
        </div>
        <div>
          <h2>{t.footerLanguage}</h2>
          <a href={`/${other}`} lang={other} hrefLang={other}>
            {other === 'en' ? 'English' : 'বাংলা'}
          </a>
        </div>
      </div>
      <div className="shell footer-bottom">
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
      </div>
    </footer>
  );
}

export function Landing({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const navItems = ['platform', 'hospitals', 'about', 'contact'];
  useReveal(page);

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
    <div className="company-page" lang={locale} id="top" ref={page}>
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
              <span className="live-dot" aria-hidden="true" />
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
              <a className="button button-primary" href={demoHref}>
                {t.demo}
                <Arrow diagonal />
              </a>
              <a className="text-link" href="#platform">
                {t.explore}
                <Arrow />
              </a>
            </div>
          </div>
          <Stage locale={locale} />
        </section>
        <section className="platform section-space" id="platform" aria-labelledby="intro-heading">
          <div className="shell">
            <div className="section-head reveal">
              <p className="eyebrow">{t.introLabel}</p>
              <h2 id="intro-heading">{t.introTitle}</h2>
              <p className="body-large">{t.intro}</p>
            </div>
            <div className="reveal">
              <Workflow locale={locale} />
            </div>
          </div>
        </section>
        <section
          className="hospitals shell section-space"
          id="hospitals"
          aria-labelledby="hospital-heading"
        >
          <div className="section-head reveal">
            <p className="eyebrow">{t.hospitalLabel}</p>
            <h2 id="hospital-heading">{t.hospitalTitle}</h2>
            <p className="body-large">{t.hospitalBody}</p>
          </div>
          <ol className="steps reveal">
            {t.steps.map((step, index) => (
              <li key={step.title}>
                <span className="step-number" aria-hidden="true">
                  {locale === 'bn' ? ['০১', '০২', '০৩'][index] : ['01', '02', '03'][index]}
                </span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="about section-space" id="about" aria-labelledby="about-heading">
          <div className="shell about-grid">
            <div className="reveal">
              <p className="eyebrow">{t.aboutLabel}</p>
              <h2 id="about-heading">{t.aboutTitle}</h2>
              <p className="body-large">{t.aboutBody}</p>
            </div>
            <ul className="principles reveal">
              {t.principles.map((item) => (
                <li key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className="contact-section" id="contact" aria-labelledby="contact-heading">
          <div className="shell section-space contact-grid reveal">
            <div>
              <p className="eyebrow">{t.contactLabel}</p>
              <h2 id="contact-heading">{t.contactTitle}</h2>
              <p>{t.contactBody}</p>
              <a className="button button-light" href={demoHref}>
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
        </section>
      </main>
      <Footer locale={locale} />
    </div>
  );
}
