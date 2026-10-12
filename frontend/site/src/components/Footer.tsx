import { cinematic } from '@/content/cinematic';
import { contactEmail, copy, demoHref } from '@/content/copy';

import { fmt } from './format';
import { LanguageSwitch, Mark } from './Header';
import { Icon } from './icons';

import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

export function Footer({
  locale,
  path = '',
}: {
  readonly locale: Locale;
  /** The page's path after the locale, so the language switch stays on the same page. */
  readonly path?: string;
}): ReactNode {
  const t = copy[locale];
  const home = `/${locale}`;
  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div className="footer-brand">
          <Mark />
          <p>{t.footer}</p>
        </div>
        <nav aria-label={t.footerExplore}>
          <h2>{t.footerExplore}</h2>
          {t.footerLinks.map((link) => (
            <a key={link.id} href={`${home}#${link.id}`}>
              {link.label}
            </a>
          ))}
        </nav>
        <nav aria-label={t.footerCompany}>
          <h2>{t.footerCompany}</h2>
          <a href={`${home}/founders`}>{t.footerFounders}</a>
          <a href={`${home}#trust`}>{t.trustLink}</a>
          <a href={`${home}/privacy`}>{t.privacy}</a>
          <a href={`${home}/credits`}>{t.credits}</a>
        </nav>
        <div>
          <h2>{t.footerContact}</h2>
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
          <a href={demoHref}>{t.demo}</a>
          <h2 className="footer-subhead">{t.footerLanguage}</h2>
          <LanguageSwitch locale={locale} path={path} />
        </div>
      </div>
      <p className="shell campaign-disclosure">{cinematic[locale].synthetic}</p>
      <div className="shell footer-bottom">
        <span>
          © {fmt(new Date().getFullYear(), locale)} {t.copyright}
        </span>
        <a href="#top">
          {t.backTop}
          <Icon name="diagonal" className="arrow arrow-up" />
        </a>
      </div>
    </footer>
  );
}
