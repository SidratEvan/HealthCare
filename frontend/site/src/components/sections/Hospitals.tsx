import { copy, demoHref } from '@/content/copy';

import { CurtainReveal, Stethoscope } from '../Cinema';
import { fmt } from '../format';
import { Icon } from '../icons';
import { Reveal, RevealItem, RevealList } from '../motion';
import { Photo, PhotoCredit } from '../Photo';

import type { IconName } from '../icons';
import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

const ICONS: readonly IconName[] = ['people', 'eye', 'desk', 'heart', 'layers', 'palette'];

/** A glimpse of the hospital side: shapes and states, not a workflow (illustration). */
function ConsoleGlimpse({ locale }: { readonly locale: Locale }): ReactNode {
  const g = copy[locale].glimpse;
  return (
    <div className="console-glimpse" aria-hidden="true">
      <span className="cg-bar">
        <span className="dc-dots">
          <i />
          <i />
          <i />
        </span>
        <b>{g.today}</b>
        <em className="glimpse-live">
          <span className="live-dot" />
          {g.live}
        </em>
      </span>
      <span className="cg-grid">
        {[0.78, 0.56, 0.9, 0.66].map((width, index) => (
          <span key={width} className="cg-tile">
            <i className={`glimpse-avatar a${String(index % 3)}`} />
            <span className="glimpse-bars">
              <i style={{ width: `${String(width * 100)}%` }} />
              <i style={{ width: `${String(width * 50)}%` }} />
            </span>
            <b>{fmt([6, 3, 11, 4][index] ?? 1, locale)}</b>
          </span>
        ))}
      </span>
      <span className="cg-beds">
        <small>{g.beds}</small>
        <span className="cg-bed-row">
          {Array.from({ length: 14 }, (_, index) => (
            <i
              key={index}
              className={`bed-dot b${String([0, 1, 1, 0, 1, 2, 1, 0, 1, 1, 0, 1, 2, 1][index] ?? 1)}`}
            />
          ))}
        </span>
        <small className="cg-fresh">
          <span className="live-dot" />
          {g.fresh}
        </small>
      </span>
      <span className="cg-tag">{g.illustrative}</span>
    </div>
  );
}

/** What a hospital gains, said as benefits; the details wait for the demonstration (S-C-04). */
export function Hospitals({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  return (
    <section className="hospitals section-space" id="hospitals" aria-labelledby="hospitals-heading">
      <div className="shell hospitals-layout">
        <div className="hospitals-media">
          <Stethoscope className="hospitals-instrument" />
          <CurtainReveal className="hospitals-photo">
            <Photo
              name="nurses"
              alt={t.hospitalsAlt}
              sizes="(max-width: 1080px) 92vw, 520px"
              position="50% 0%"
            />
            <PhotoCredit name="nurses" label={t.photoCredit} />
          </CurtainReveal>
          <Reveal className="hospitals-glimpse" delay={0.35} y={40}>
            <ConsoleGlimpse locale={locale} />
          </Reveal>
        </div>
        <div className="hospitals-copy">
          <Reveal className="section-head">
            <p className="eyebrow">{t.hospitalsLabel}</p>
            <h2 id="hospitals-heading">{t.hospitalsTitle}</h2>
            <p className="body-large">{t.hospitalsBody}</p>
          </Reveal>
          <RevealList className="benefits">
            {t.hospitalBenefits.map((benefit, index) => (
              <RevealItem key={benefit.title} className="benefit">
                <span className="benefit-icon" aria-hidden="true">
                  <Icon name={ICONS[index] ?? 'check'} />
                </span>
                <h3>{benefit.title}</h3>
                <p>{benefit.body}</p>
              </RevealItem>
            ))}
          </RevealList>
          <Reveal className="hospitals-cta" delay={0.1}>
            <a className="button button-primary button-large" href={demoHref}>
              {t.demoPrivate}
              <Icon name="diagonal" className="arrow" />
            </a>
            <p>
              <Icon name="shield" />
              {t.hospitalsNote}
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
