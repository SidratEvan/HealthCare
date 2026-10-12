import { copy, demoHref } from '@/content/copy';

import { HeroVisual } from '../HeroVisual';
import { Icon } from '../icons';

import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

/** The first screen: who MedLiveBD is, in one line, with Bangladesh behind it (S-C-01). */
export function Hero({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  return (
    <section className="hero" aria-labelledby="hero-heading">
      <div className="hero-bg" aria-hidden="true">
        <i className="aurora aurora-a" />
        <i className="aurora aurora-b" />
        <i className="aurora aurora-c" />
        <i className="hero-grid-lines" />
      </div>
      <div className="shell hero-layout">
        <div className="hero-copy">
          <p className="eyebrow eyebrow-pill">
            <span className="live-dot" aria-hidden="true" />
            {t.eyebrow}
          </p>
          <h1 id="hero-heading">
            {t.hero.map((part) =>
              part.accent ? (
                <span key={part.text} className="hero-accent">
                  {part.text}
                </span>
              ) : (
                part.text
              ),
            )}
          </h1>
          <p className="hero-lead">{t.lead}</p>
          <div className="hero-actions">
            <a className="button button-primary button-large" href={demoHref}>
              {t.demo}
              <Icon name="diagonal" className="arrow" />
            </a>
            <a className="button button-ghost button-large" href="#vision">
              {t.discover}
              <Icon name="arrow" className="arrow arrow-down" />
            </a>
          </div>
          <ul className="hero-points">
            {t.heroPoints.map((point) => (
              <li key={point}>
                <Icon name="check" />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <HeroVisual locale={locale} />
      </div>
    </section>
  );
}
