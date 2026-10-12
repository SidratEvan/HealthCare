import { copy } from '@/content/copy';

import { Icon } from '../icons';
import { Reveal, RevealItem, RevealList } from '../motion';

import type { IconName } from '../icons';
import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

const ICONS: readonly IconName[] = ['clock', 'lock', 'shield', 'key', 'map', 'people'];

/** Rules the platform enforces, stated plainly (S-C-04, FR-SEC-*, FR-IMP-17). */
export function Trust({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  return (
    <section className="trust dark-band section-space" id="trust" aria-labelledby="trust-heading">
      <div className="trust-glow" aria-hidden="true" />
      <div className="shell">
        <Reveal className="section-head section-head-split">
          <div>
            <p className="eyebrow">{t.trustLabel}</p>
            <h2 id="trust-heading">{t.trustTitle}</h2>
          </div>
          <p className="body-large">{t.trustBody}</p>
        </Reveal>
        <RevealList className="trust-grid">
          {t.trust.map((entry, index) => (
            <RevealItem key={entry.title} className="trust-card">
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
