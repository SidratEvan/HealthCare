'use client';

import { m, useScroll, useSpring } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

import { copy, demoHref } from '@/content/copy';

import { Icon } from './icons';
import { EASE } from './motion';

import type { Locale } from '@/content/copy';
import type { MouseEvent, ReactNode } from 'react';

export function Mark({ priority = false }: { readonly priority?: boolean }): ReactNode {
  return (
    <img
      className="brand-logo"
      src="/brand/medlivebd-logo-light.webp"
      width="330"
      height="218"
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

export function Header({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
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
              <a key={link.id} href={`#${link.id}`}>
                {link.label}
              </a>
            ))}
          </nav>
          <div className="header-actions">
            <LanguageSwitch locale={locale} />
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
                href={`#${link.id}`}
                variants={{
                  hidden: { opacity: 0, y: 16 },
                  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
                }}
                onClick={() => {
                  setOpen(false);
                }}
              >
                {link.label}
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
                href={`#contact`}
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
