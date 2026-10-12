import { copy } from '@/content/copy';

import { CurtainReveal, ScrollEcg } from '../Cinema';
import { Icon } from '../icons';
import { Reveal } from '../motion';
import { Photo, PhotoCredit } from '../Photo';

import type { Locale } from '@/content/copy';
import type { PhotoKey } from '@/content/photos';
import type { ReactNode } from 'react';

/**
 * One ecosystem, two experiences (owner, 12 October 2026): the hospital and
 * the patient, side by side, joined by the platform between them.
 */
export function Experiences({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  const x = t.experiences;
  const cards: readonly {
    key: 'hospitals' | 'patients';
    photo: PhotoKey;
    position: string;
  }[] = [
    { key: 'hospitals', photo: 'lab', position: '35% 40%' },
    { key: 'patients', photo: 'paddy', position: '30% 45%' },
  ];
  return (
    <section className="xp section-space" id="experiences" aria-labelledby="xp-heading">
      <div className="shell">
        <Reveal className="section-head section-head-center">
          <p className="eyebrow">{t.experiencesLabel}</p>
          <h2 id="xp-heading">{t.experiencesTitle}</h2>
        </Reveal>
        <div className="xp-pair">
          {cards.map((card, index) => {
            const c = x[card.key];
            return (
              <CurtainReveal
                key={card.key}
                className={`xp-card xp-${card.key}`}
                delay={index * 0.15}
              >
                <Photo
                  name={card.photo}
                  alt={c.alt}
                  sizes="(max-width: 860px) 92vw, 46vw"
                  className="xp-photo"
                  position={card.position}
                />
                <i className="xp-shade" aria-hidden="true" />
                <div className="xp-body">
                  <span className="xp-chip">{c.chip}</span>
                  <h3>{c.title}</h3>
                  <ul>
                    {c.points.map((point) => (
                      <li key={point}>
                        <Icon name="check" />
                        {point}
                      </li>
                    ))}
                  </ul>
                  <a className="xp-link" href={`#${card.key}`}>
                    {c.cta}
                    <Icon name="arrow" className="arrow arrow-down" />
                  </a>
                </div>
                <PhotoCredit name={card.photo} label={t.photoCredit} />
              </CurtainReveal>
            );
          })}
          <div className="xp-node" aria-hidden="true">
            <ScrollEcg className="xp-ecg" beats={2} />
            <span className="xp-core">
              <i />
              <Icon name="pulse" />
            </span>
            <span className="xp-node-label">{x.connector}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
