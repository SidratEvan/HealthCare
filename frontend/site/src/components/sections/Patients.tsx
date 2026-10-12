import { copy } from '@/content/copy';

import { PhoneFrame, screen } from '../frames';
import { Icon } from '../icons';
import { Reveal, RevealItem, RevealList } from '../motion';

import type { IconName } from '../icons';
import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

const ICONS: readonly IconName[] = ['search', 'ticket', 'pulse', 'folder', 'siren'];

/** The patient side of the same live queue (S-C-02). */
export function Patients({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  return (
    <section className="patients section-space" id="patients" aria-labelledby="patients-heading">
      <div className="shell patients-layout">
        <Reveal className="patients-visual" y={40}>
          <div className="patients-orbit" aria-hidden="true">
            <i />
            <i />
          </div>
          <PhoneFrame src={screen('patient', locale)} alt={t.patientAlt} />
          <span className="float-chip float-chip-a" aria-hidden="true">
            <span className="live-dot" />
            {t.live.updated}
          </span>
          <span className="float-chip float-chip-b" aria-hidden="true">
            <Icon name="globe" />
            {t.patientLanguages}
          </span>
        </Reveal>
        <div className="patients-copy">
          <Reveal className="section-head">
            <p className="eyebrow">{t.patientLabel}</p>
            <h2 id="patients-heading">{t.patientTitle}</h2>
            <p className="body-large">{t.patientBody}</p>
          </Reveal>
          <RevealList className="feature-list">
            {t.patientPoints.map((point, index) => (
              <RevealItem key={point.title}>
                <span className="feature-icon" aria-hidden="true">
                  <Icon name={ICONS[index] ?? 'check'} />
                </span>
                <span>
                  <h3>{point.title}</h3>
                  <p>{point.body}</p>
                </span>
              </RevealItem>
            ))}
          </RevealList>
        </div>
      </div>
    </section>
  );
}
