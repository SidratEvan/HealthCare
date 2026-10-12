import { copy, demoHref } from '@/content/copy';

import { CurtainReveal, Parallax } from '../Cinema';
import { fmt } from '../format';
import { Icon } from '../icons';
import { Reveal, RevealItem, RevealList } from '../motion';
import { Photo, PhotoCredit } from '../Photo';

import type { IconName } from '../icons';
import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

const ICONS: readonly IconName[] = ['search', 'ticket', 'clock', 'shield', 'globe'];

/** A glimpse of the patient app on demonstration figures — calm, not a tour. */
function PhoneGlimpse({ locale }: { readonly locale: Locale }): ReactNode {
  const p = copy[locale].phone;
  return (
    <div className="phone-glimpse" aria-hidden="true">
      <span className="pg-status">
        <span>{locale === 'bn' ? '৯:৪১' : '9:41'}</span>
        <i className="pg-notch" />
        <span className="pg-signal">
          <i />
          <i />
          <i />
        </span>
      </span>
      <span className="pg-title">{p.title}</span>
      <span className="pg-hospital">
        <i className="glimpse-avatar a1" />
        <span className="glimpse-bars">
          <i style={{ width: '78%' }} />
          <i style={{ width: '46%' }} />
        </span>
      </span>
      <span className="pg-card">
        <small>{p.yourSerial}</small>
        <b>{fmt(9, locale)}</b>
        <span className="pg-tiles">
          <span>
            <small>{p.nowServing}</small>
            <strong>{fmt(7, locale)}</strong>
          </span>
          <span>
            <small>{p.ahead}</small>
            <strong>{fmt(2, locale)}</strong>
          </span>
        </span>
        <span className="pg-progress">
          <i />
        </span>
        <span className="glimpse-fresh">
          <span className="live-dot" />
          {p.updated}
        </span>
      </span>
      <span className="pg-steps">
        {p.steps.map((step, index) => (
          <span key={step} className={index === 1 ? 'is-now' : index === 0 ? 'is-done' : ''}>
            <i />
            {step}
          </span>
        ))}
      </span>
    </div>
  );
}

/** The patient's side, warmly and accurately: not yet open to the public (S-C-02). */
export function Patients({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  return (
    <section className="patients section-space" id="patients" aria-labelledby="patients-heading">
      <div className="shell patients-layout">
        <div className="patients-copy">
          <Reveal className="section-head">
            <p className="eyebrow">{t.patientsLabel}</p>
            <h2 id="patients-heading">{t.patientsTitle}</h2>
            <p className="body-large">{t.patientsBody}</p>
          </Reveal>
          <RevealList className="journey">
            {t.patientBenefits.map((benefit, index) => (
              <RevealItem key={benefit.title} className="journey-step">
                <span className="journey-icon" aria-hidden="true">
                  <Icon name={ICONS[index] ?? 'check'} />
                </span>
                <span>
                  <h3>{benefit.title}</h3>
                  <p>{benefit.body}</p>
                </span>
              </RevealItem>
            ))}
          </RevealList>
          <Reveal className="patients-status" delay={0.1}>
            <span className="status-chip">
              <span className="live-dot" aria-hidden="true" />
              {t.comingSoon}
            </span>
            <p>{t.patientsStatus}</p>
            <a className="text-link" href={demoHref}>
              {t.patientsHospitalAsk} {t.demo}
              <Icon name="diagonal" className="arrow" />
            </a>
          </Reveal>
        </div>
        <div className="patients-media">
          <CurtainReveal className="patients-photo">
            <Parallax className="patients-parallax" distance={40} zoom={0.08}>
              <Photo
                name="tea"
                alt={t.patientsAlt}
                sizes="(max-width: 1080px) 92vw, 600px"
                position="40% 50%"
              />
            </Parallax>
            <PhotoCredit name="tea" label={t.photoCredit} />
          </CurtainReveal>
          <Reveal className="patients-phone" delay={0.35} y={60}>
            <PhoneGlimpse locale={locale} />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
