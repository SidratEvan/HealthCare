import { copy } from '@/content/copy';

import { Icon } from '../icons';
import { Reveal, RevealItem, RevealList } from '../motion';

import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

/** Why live operations matter, as the day looks with and without them (S-C-02). */
export function Problem({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  return (
    <section className="problem section-space" id="why" aria-labelledby="problem-heading">
      <div className="shell problem-layout">
        <Reveal className="section-head">
          <p className="eyebrow">{t.problemLabel}</p>
          <h2 id="problem-heading">{t.problemTitle}</h2>
          <p className="body-large">{t.problemBody}</p>
        </Reveal>
        <div className="compare">
          <div className="compare-head" aria-hidden="true">
            <span>{t.problemBefore}</span>
            <span className="compare-after-head">
              <span className="live-dot" />
              {t.problemAfter}
            </span>
          </div>
          <RevealList className="compare-rows">
            {t.problems.map((row) => (
              <RevealItem key={row.before} className="compare-row">
                <p className="compare-before">
                  <span className="sr-only">{t.problemBefore}: </span>
                  {row.before}
                </p>
                <p className="compare-after">
                  <Icon name="check" />
                  <span>
                    <span className="sr-only">{t.problemAfter}: </span>
                    {row.after}
                  </span>
                </p>
              </RevealItem>
            ))}
          </RevealList>
        </div>
      </div>
    </section>
  );
}
