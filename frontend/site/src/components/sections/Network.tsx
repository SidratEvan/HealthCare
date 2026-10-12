import { copy } from '@/content/copy';

import { Icon } from '../icons';
import { Reveal } from '../motion';

import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

/** Many hospitals, one search, each hospital's own data kept to itself (FR-NET-01–03, S-C-02). */
export function Network({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  return (
    <section className="network section-space" id="network" aria-labelledby="network-heading">
      <div className="shell network-layout">
        <Reveal className="section-head">
          <p className="eyebrow">{t.networkLabel}</p>
          <h2 id="network-heading">{t.networkTitle}</h2>
          <p className="body-large">{t.networkBody}</p>
          <div className="network-lists">
            <div>
              <h3>
                <Icon name="globe" />
                {t.networkShared}
              </h3>
              <ul>
                {t.networkSharedItems.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            </div>
            <div className="is-private">
              <h3>
                <Icon name="lock" />
                {t.networkPrivate}
              </h3>
              <ul>
                {t.networkPrivateItems.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
        <Reveal className="net-figure" delay={0.1} y={36}>
          <figure>
            <div className="net-map" aria-hidden="true">
              <svg className="net-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
                <path d="M50 16 C 50 36, 18 38, 18 44" vectorEffect="non-scaling-stroke" />
                <path d="M50 16 L 50 44" vectorEffect="non-scaling-stroke" />
                <path d="M50 16 C 50 36, 82 38, 82 44" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="net-search">
                <Icon name="search" />
                {t.networkSearch}
              </div>
              {t.networkHospitals.map((hospital, index) => (
                <div
                  key={hospital.name}
                  className={`net-hospital net-h${String(index)}${hospital.live ? '' : ' is-stale'}`}
                >
                  <span className="net-name">
                    <Icon name="lock" />
                    {hospital.name}
                  </span>
                  <strong>{hospital.figure}</strong>
                  <span className="net-age">
                    {hospital.live ? <span className="live-dot" /> : <Icon name="clock" />}
                    {hospital.age}
                  </span>
                </div>
              ))}
              <div className="net-wall">
                <Icon name="lock" />
                {t.networkWall}
              </div>
            </div>
            <figcaption>{t.networkIllustrative}</figcaption>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}
