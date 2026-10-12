'use client';

import { m, useScroll, useSpring } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

import { audienceHref, copy, demoHref } from '@/content/copy';

import { Icon } from './icons';
import { EASE } from './motion';

import type { Locale } from '@/content/copy';
import type { MouseEvent, ReactNode } from 'react';

export function Mark({ priority = false }: { readonly priority?: boolean }): ReactNode {
  return (
    <img
      className="brand-logo"
      src="/brand/medlivebd-logo-480.webp"
      width="480"
      height="317"
      alt="MedLiveBD"
      fetchPriority={priority ? 'high' : 'auto'}
    />
  );
}

/** Carries the reader's place across the switch, so a language change is not a restart. */
function keepPlace(event: MouseEvent<HTMLAnchorElement>): void {
  if (window.location.hash === '') return;
  const link = event.currentTarget;
  link.href = `${link.pathname}${window.location.hash}`;
}

/** Both languages, the current one marked — the switch reads as part of the page. */
export function LanguageSwitch({
  locale,
  path = '',
}: {
  readonly locale: Locale;
  readonly path?: string;
}): ReactNode {
  const other = locale === 'bn' ? 'en' : 'bn';
  const t = copy[locale];
  const items = (['bn', 'en'] as const).map((code) =>
    code === locale ? (
      <span key={code} className="lang-option is-current" lang={code} aria-current="true">
        {code === 'bn' ? 'বাংলা' : 'EN'}
      </span>
    ) : (
      <a
        key={code}
        className="lang-option language-link"
        href={`/${other}${path}`}
        lang={other}
        hrefLang={other}
        aria-label={t.otherLanguageLabel}
        onClick={keepPlace}
      >
        {code === 'bn' ? 'বাংলা' : 'EN'}
      </a>
    ),
  );
  return <div className="lang-switch">{items}</div>;
}

const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const;

/** The patient app is a demonstration: every link to it says so (owner, 12 October 2026). */
export function PatientAppTag({ locale }: { readonly locale: Locale }): ReactNode {
  return (
    <>
      <span className="demo-tag nav-demo-tag">{copy[locale].navDemo}</span>
      <span className="sr-only">{copy[locale].newTab}</span>
    </>
  );
}

/** Where a navigation item leads: a scene of the home page, or the founders page (S-C-01). */
function navHref(locale: Locale, id: string, onHome: boolean): string {
  const audience = audienceHref[id];
  if (audience !== undefined) return audience;
  if (id === 'founders') return `/${locale}/founders`;
  return onHome ? `#${id}` : `/${locale}#${id}`;
}

export function Header({
  locale,
  page = 'home',
}: {
  readonly locale: Locale;
  readonly page?: 'home' | 'founders';
}): ReactNode {
  const t = copy[locale];
  const onHome = page === 'home';
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, restDelta: 0.001 });

  useEffect(() => {
    const onScroll = (): void => {
      setScrolled(window.scrollY > 8);
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
    const covered = [...document.querySelectorAll<HTMLElement>('main, .site-footer')];
    covered.forEach((element) => {
      element.setAttribute('inert', '');
    });
    const close = (event: KeyboardEvent): void => {
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
    const desktop = window.matchMedia('(min-width: 961px)');
    const closeOnDesktop = (): void => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => {
      desktop.removeEventListener('change', closeOnDesktop);
    };
  }, []);

  return (
    <>
      <header className="site-header" data-scrolled={scrolled || open ? 'true' : 'false'}>
        <div className="shell header-inner">
          <a className="brand-link" href={`/${locale}`} aria-label="MedLiveBD">
            <Mark priority />
          </a>
          <nav className="desktop-nav" aria-label={t.menu}>
            {t.nav.map((link) => (
              <a
                key={link.id}
                href={navHref(locale, link.id, onHome)}
                {...(link.id === 'patients' ? NEW_TAB : {})}
                aria-current={link.id === page ? 'page' : undefined}
              >
                {link.label}
                {link.id === 'patients' ? <PatientAppTag locale={locale} /> : null}
              </a>
            ))}
          </nav>
          <div className="header-actions">
            <LanguageSwitch locale={locale} path={onHome ? '' : `/${page}`} />
            <a className="button button-primary button-small header-cta" href={demoHref}>
              {t.demo}
            </a>
            <button
              className="menu-toggle"
              type="button"
              ref={toggle}
              onClick={() => {
                setOpen(!open);
              }}
              aria-expanded={open}
              aria-controls="mobile-navigation"
              aria-label={open ? t.close : t.menu}
            >
              <span />
              <span />
            </button>
          </div>
        </div>
        <m.div className="scroll-progress" style={{ scaleX: progress }} aria-hidden="true" />
      </header>
      <nav id="mobile-navigation" className="mobile-nav" aria-label={t.menu} hidden={!open}>
        {open ? (
          <m.div
            className="mobile-nav-inner shell"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
          >
            {t.nav.map((link) => (
              <m.a
                key={link.id}
                href={navHref(locale, link.id, onHome)}
                {...(link.id === 'patients' ? NEW_TAB : {})}
                variants={{
                  hidden: { opacity: 0, y: 16 },
                  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
                }}
                onClick={() => {
                  setOpen(false);
                }}
              >
                {link.label}
                {link.id === 'patients' ? <PatientAppTag locale={locale} /> : null}
                <Icon name="arrow" className="arrow" />
              </m.a>
            ))}
            <m.div
              className="mobile-nav-foot"
              variants={{
                hidden: { opacity: 0 },
                show: { opacity: 1, transition: { duration: 0.5, delay: 0.15 } },
              }}
            >
              <a className="button button-primary" href={demoHref}>
                {t.demo}
                <Icon name="diagonal" className="arrow" />
              </a>
              <a
                className="mobile-contact"
                href={onHome ? '#contact' : `/${locale}#contact`}
                onClick={() => {
                  setOpen(false);
                }}
              >
                {t.footerContact}
              </a>
            </m.div>
          </m.div>
        ) : null}
      </nav>
    </>
  );
}
