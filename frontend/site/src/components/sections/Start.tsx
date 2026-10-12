import { copy } from '@/content/copy';

import { ordinal } from '../format';
import { Icon } from '../icons';
import { Reveal, RevealItem, RevealList } from '../motion';

import type { IconName } from '../icons';
import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

const ICONS: readonly IconName[] = ['sliders', 'upload', 'rehearse', 'rocket'];

/** How a hospital starts: configure, import, rehearse, go live (FR-ONB-*, FR-IMP-*, S-C-04). */
export function Start({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  return (
    <section className="start section-space" id="start" aria-labelledby="start-heading">
      <div className="shell">
        <Reveal className="section-head section-head-split">
          <div>
            <p className="eyebrow">{t.startLabel}</p>
            <h2 id="start-heading">{t.startTitle}</h2>
          </div>
          <p className="body-large">{t.startBody}</p>
        </Reveal>
        <RevealList className="timeline" ordered>
          {t.steps.map((step, index) => (
            <RevealItem key={step.title} className="timeline-step">
              <span className="timeline-marker" aria-hidden="true">
                <Icon name={ICONS[index] ?? 'check'} />
              </span>
              <span className="timeline-num" aria-hidden="true">
                {ordinal(index + 1, locale)}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </RevealItem>
          ))}
        </RevealList>
      </div>
    </section>
  );
}
