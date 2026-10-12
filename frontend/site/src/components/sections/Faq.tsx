import { copy } from '@/content/copy';

import { Icon } from '../icons';
import { Reveal } from '../motion';

import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

/** The questions a hospital asks first, answered as the platform stands today. */
export function Faq({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  return (
    <section className="faq section-space" id="faq" aria-labelledby="faq-heading">
      <div className="shell faq-layout">
        <Reveal className="section-head">
          <p className="eyebrow">{t.faqLabel}</p>
          <h2 id="faq-heading">{t.faqTitle}</h2>
        </Reveal>
        <Reveal className="faq-list" delay={0.08}>
          {t.faq.map((entry) => (
            <details key={entry.q}>
              <summary>
                <span>{entry.q}</span>
                <Icon name="plus" className="faq-icon" />
              </summary>
              <p>{entry.a}</p>
            </details>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
