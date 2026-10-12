import { copy } from '@/content/copy';

import { Icon } from '../icons';
import { Reveal, RevealItem, RevealList } from '../motion';

import type { IconName } from '../icons';
import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

const ICONS: readonly IconName[] = ['lock', 'key', 'clock', 'people'];

/** Short, factual commitments — rules the platform enforces, no certifications claimed (S-C-04). */
export function Trust({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  return (
    <section className="trust section-space" id="trust" aria-labelledby="trust-heading">
      <div className="shell trust-layout">
        <Reveal className="section-head">
          <p className="eyebrow">{t.trustLabel}</p>
          <h2 id="trust-heading">{t.trustTitle}</h2>
        </Reveal>
        <RevealList className="trust-list">
          {t.trust.map((entry, index) => (
            <RevealItem key={entry.title} className="trust-item">
              <span className="trust-icon" aria-hidden="true">
                <Icon name={ICONS[index] ?? 'shield'} />
              </span>
              <h3>{entry.title}</h3>
              <p>{entry.body}</p>
            </RevealItem>
          ))}
        </RevealList>
      </div>
    </section>
  );
}
