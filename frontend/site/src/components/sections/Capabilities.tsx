import { copy } from '@/content/copy';

import { fmt } from '../format';
import { Icon } from '../icons';
import { Reveal, RevealItem, RevealList } from '../motion';

import type { IconName } from '../icons';
import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

/** A serial counter that rolls through its values in CSS — cheap enough to leave running. */
function Odometer({
  values,
  locale,
  className = '',
}: {
  readonly values: readonly number[];
  readonly locale: Locale;
  readonly className?: string;
}): ReactNode {
  return (
    <span className={`odo ${className}`}>
      <span className="odo-strip">
        {values.map((value, index) => (
          <span key={`${String(value)}-${String(index)}`}>{fmt(value, locale)}</span>
        ))}
      </span>
    </span>
  );
}

function ReceptionVisual({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale].live;
  const rows = [
    { doctor: t.doctors[0], values: [6, 7, 8, 9, 6], waiting: [12, 11, 10, 9, 12] },
    { doctor: t.doctors[1], values: [3, 3, 4, 4, 3], waiting: [7, 7, 6, 6, 7] },
    { doctor: t.doctors[2], values: [11, 12, 12, 13, 11], waiting: [4, 3, 3, 2, 4] },
  ];
  return (
    <div className="v-reception">
      {rows.map((row, index) => (
        <div key={row.doctor?.name ?? index} className={`v-chamber v-chamber-${String(index)}`}>
          <span className="v-who">
            <strong>{row.doctor?.name}</strong>
            <small>{row.doctor?.dept}</small>
          </span>
          <span className="v-now">
            <small>{t.nowServing}</small>
            <Odometer values={row.values} locale={locale} className={`odo-${String(index)}`} />
          </span>
          <span className="v-wait">
            <Odometer values={row.waiting} locale={locale} className={`odo-${String(index)}`} />
            <small>{t.waiting}</small>
          </span>
          <span className="v-call">{t.callNext}</span>
        </div>
      ))}
    </div>
  );
}

const BEDS = [0, 1, 1, 0, 1, 2, 1, 1, 3, 1, 0, 1, 1, 2, 1, 0] as const;

function BedsVisual({ locale }: { readonly locale: Locale }): ReactNode {
  const c = copy[locale].cap.beds;
  return (
    <div className="v-beds">
      <div className="v-bed-grid">
        {BEDS.map((state, index) => (
          <i key={index} className={`bed bed-${String(state)} bed-n${String(index)}`} />
        ))}
      </div>
      <ul className="v-legend">
        {c.states.map((label, index) => (
          <li key={label}>
            <i className={`bed bed-${String(index)}`} />
            {label}
          </li>
        ))}
      </ul>
      <p className="v-fresh">
        <span className="live-dot" />
        {c.fresh}
      </p>
    </div>
  );
}

function EmergencyVisual({ locale }: { readonly locale: Locale }): ReactNode {
  const c = copy[locale].cap.emergency;
  return (
    <div className="v-er">
      <div className="v-alert">
        <span className="v-alert-head">
          <Icon name="siren" />
          {c.alert}
        </span>
        <span className="v-triage">
          {c.triage.map((label, index) => (
            <em key={label} className={`tri tri-${String(index)}`}>
              {label}
            </em>
          ))}
        </span>
        <span className="v-ready">{c.accept}</span>
      </div>
    </div>
  );
}

function LabVisual({ locale }: { readonly locale: Locale }): ReactNode {
  const c = copy[locale].cap.lab;
  return (
    <div className="v-lab">
      <span className="v-lab-track">
        <i />
      </span>
      <ol>
        {c.stages.map((label, index) => (
          <li key={label} className={`stage-${String(index)}`}>
            <i />
            {label}
          </li>
        ))}
      </ol>
    </div>
  );
}

function DoctorVisual({ locale }: { readonly locale: Locale }): ReactNode {
  const c = copy[locale].cap.doctor;
  return (
    <div className="v-doc">
      {c.rows.map((label, index) => (
        <span key={label} className={`v-doc-row row-${String(index)}`}>
          <b>{fmt(index + 1, locale)}</b>
          {label}
          <Icon name="check" />
        </span>
      ))}
      <span className="v-sign">{c.sign}</span>
    </div>
  );
}

function OfflineVisual({ locale }: { readonly locale: Locale }): ReactNode {
  const c = copy[locale].cap.offline;
  return (
    <div className="v-off">
      <span className="v-off-pill">
        <span className="off-state">
          <Icon name="wifiOff" />
          {c.offline} · {fmt(3, locale)}
          {locale === 'bn' ? '' : ' '}
          {c.kept}
        </span>
        <span className="on-state">
          <Icon name="check" />
          {c.online}
        </span>
      </span>
      <span className="v-off-queue">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

function BrandVisual({ locale }: { readonly locale: Locale }): ReactNode {
  const c = copy[locale].cap.brand;
  return (
    <div className="v-brand">
      <div className="v-portal">
        <span className="v-portal-bar">
          <i className="v-portal-logo">
            <Icon name="plus" />
          </i>
          <span>
            <strong>{c.hospital}</strong>
            <small>{c.powered}</small>
          </span>
        </span>
        <span className="v-portal-body">
          <i />
          <i />
          <i className="v-portal-button" />
        </span>
      </div>
      <span className="v-swatches">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

interface Card {
  readonly key: 'reception' | 'beds' | 'emergency' | 'lab' | 'doctor' | 'offline' | 'brand';
  readonly icon: IconName;
  readonly wide?: boolean;
  readonly visual: (locale: Locale) => ReactNode;
}
const CARDS: readonly Card[] = [
  {
    key: 'reception',
    icon: 'desk',
    wide: true,
    visual: (locale) => <ReceptionVisual locale={locale} />,
  },
  { key: 'beds', icon: 'bed', visual: (locale) => <BedsVisual locale={locale} /> },
  { key: 'emergency', icon: 'siren', visual: (locale) => <EmergencyVisual locale={locale} /> },
  { key: 'lab', icon: 'flask', visual: (locale) => <LabVisual locale={locale} /> },
  { key: 'doctor', icon: 'doctor', visual: (locale) => <DoctorVisual locale={locale} /> },
  { key: 'offline', icon: 'wifiOff', visual: (locale) => <OfflineVisual locale={locale} /> },
  {
    key: 'brand',
    icon: 'palette',
    wide: true,
    visual: (locale) => <BrandVisual locale={locale} />,
  },
];

/** What each hospital team gets, each with a small working picture (S-C-02, S-C-04). */
export function Capabilities({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  return (
    <section className="caps section-space" id="hospitals" aria-labelledby="caps-heading">
      <div className="shell">
        <Reveal className="section-head">
          <p className="eyebrow">{t.capLabel}</p>
          <h2 id="caps-heading">{t.capTitle}</h2>
          <p className="body-large">{t.capBody}</p>
        </Reveal>
        <RevealList className="bento" label={t.capLabel}>
          {CARDS.map((card) => {
            const text = t.cap[card.key];
            return (
              <RevealItem key={card.key} className={`bento-card${card.wide ? ' is-wide' : ''}`}>
                <div className="bento-visual" aria-hidden="true">
                  {card.visual(locale)}
                </div>
                <div className="bento-text">
                  <span className="bento-icon" aria-hidden="true">
                    <Icon name={card.icon} />
                  </span>
                  <h3>{text.title}</h3>
                  <p>{text.body}</p>
                </div>
              </RevealItem>
            );
          })}
        </RevealList>
      </div>
    </section>
  );
}
