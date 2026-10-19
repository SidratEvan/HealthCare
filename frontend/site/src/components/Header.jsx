'use client';

import { useEffect, useRef, useState } from 'react';

import { aboutHref, copy, hospitalsHref, patientAppHref } from '@/content/copy';

import { Icon } from './icons';
import { AudienceDoors, DemoButton, DemoTag, EmailLink, NEW_TAB } from './links';

/** The path after the locale, so the language switch stays on the same page. */
export const pagePath = (page) => (page === 'home' ? '' : `/${page}`);

/**
 * The navy lockup, derived from the supplied logo's dark panel
 * (scripts/prepare-logo.mjs): the mark beside the wordmark, white and cyan.
 */
export function Logo({ priority = false }) {
  return (
    <img
      className="logo"
      src="/brand/medlivebd-lockup-dark.webp"
      width="607"
      height="112"
      alt="MedLiveBD"
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
    />
  );
}

/** Carries the reader's place across the switch, so a language change is not a restart. */
function keepPlace(event) {
  if (window.location.hash === '') return;
  const link = event.currentTarget;
  link.href = `${link.pathname}${window.location.hash}`;
}

/** Both languages, the current one marked; the other is a link to the same page (GR-06). */
export function LanguageSwitch({ locale, page }) {
  const t = copy[locale];
  return (
    <div className="lang-switch" role="group" aria-label={t.language}>
      {['bn', 'en'].map((code) =>
        code === locale ? (
          <span key={code} className="lang-option" lang={code} aria-current="true">
            {code === 'bn' ? 'বাংলা' : 'EN'}
          </span>
        ) : (
          <a
            key={code}
            className="lang-option"
            href={`/${code}${pagePath(page)}`}
            lang={code}
            hrefLang={code}
            aria-label={t.otherLanguageLabel}
            onClick={keepPlace}
          >
            {code === 'bn' ? 'বাংলা' : 'EN'}
          </a>
        ),
      )}
    </div>
  );
}

export function Header({ locale, page }) {
  const t = copy[locale];
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const toggle = useRef(null);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 24);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add('menu-open');
    const covered = [...document.querySelectorAll('main, .site-footer')];
    covered.forEach((element) => {
      element.setAttribute('inert', '');
    });
    const close = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener('keydown', close);
    return () => {
      root.classList.remove('menu-open');
      covered.forEach((element) => {
        element.removeAttribute('inert');
      });
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => {
      desktop.removeEventListener('change', closeOnDesktop);
    };
  }, []);

  return (
    <header
      className="site-header"
      data-solid={scrolled || open || page !== 'home' ? 'true' : 'false'}
      data-open={open ? 'true' : 'false'}
    >
      <div className="shell header-bar">
        <a className="brand" href={`/${locale}`} aria-label="MedLiveBD">
          <Logo priority />
        </a>
        <nav className="primary-nav" aria-label={t.mainNav}>
          <a
            href={hospitalsHref(locale)}
            aria-current={page === 'hospitals' ? 'page' : undefined}
            data-door="hospitals"
          >
            {t.nav.hospitals}
          </a>
          <a href={patientAppHref} {...NEW_TAB} data-door="patients">
            {t.nav.patients}
            <DemoTag locale={locale} />
            <Icon name="external" className="icon nav-icon" />
          </a>
          <a href={aboutHref(locale)} aria-current={page === 'about' ? 'page' : undefined}>
            {t.nav.about}
          </a>
        </nav>
        <div className="header-end">
          <LanguageSwitch locale={locale} page={page} />
          <DemoButton locale={locale} className="header-demo" />
          <button
            className="menu-toggle"
            type="button"
            ref={toggle}
            onClick={() => {
              setOpen(!open);
            }}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? t.close : t.menu}
          >
            <span />
            <span />
          </button>
        </div>
      </div>
      <div id="mobile-menu" className="mobile-menu" hidden={!open}>
        <div className="shell mobile-menu-inner">
          <AudienceDoors locale={locale} className="doors-stacked" />
          <a className="mobile-link" href={aboutHref(locale)}>
            {t.nav.about}
            <Icon name="arrow" className="icon" />
          </a>
          <DemoButton locale={locale} className="mobile-demo" />
          <EmailLink />
          <LanguageSwitch locale={locale} page={page} />
        </div>
      </div>
    </header>
  );
}
