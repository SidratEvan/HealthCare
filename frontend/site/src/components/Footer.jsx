import {
  aboutHref,
  contactEmail,
  copy,
  demoHref,
  hospitalsHref,
  patientAppHref,
} from '@/content/copy';

import { fmt } from './format';
import { LanguageSwitch, Logo } from './Header';
import { Icon } from './icons';
import { DemoTag, NEW_TAB } from './links';

export function Footer({ locale, page }) {
  const t = copy[locale];
  const f = t.footer;
  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div className="footer-brand">
          <a href={`/${locale}`} aria-label="MedLiveBD">
            <Logo />
          </a>
          <p>{f.line}</p>
        </div>
        <nav aria-label={f.explore} className="footer-col">
          <h2>{f.explore}</h2>
          <a href={hospitalsHref(locale)}>{t.nav.hospitals}</a>
          <a href={patientAppHref} {...NEW_TAB}>
            {t.nav.patients}
            <DemoTag locale={locale} />
          </a>
          <a href={demoHref}>{t.demo}</a>
        </nav>
        <nav aria-label={f.company} className="footer-col">
          <h2>{f.company}</h2>
          <a href={aboutHref(locale)}>{t.nav.about}</a>
          <a href={`/${locale}/privacy`}>{f.privacy}</a>
          <a href={`/${locale}/credits`}>{f.credits}</a>
        </nav>
        <div className="footer-col">
          <h2>{f.contact}</h2>
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
          <LanguageSwitch locale={locale} page={page} />
        </div>
      </div>
      <div className="shell footer-base">
        <p>{f.synthetic}</p>
        <div className="footer-base-end">
          <span>© {fmt(new Date().getFullYear(), locale)} MedLiveBD</span>
          <a href="#top">
            {f.backTop}
            <Icon name="up" className="icon" />
          </a>
        </div>
      </div>
    </footer>
  );
}
