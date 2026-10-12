'use client';

import { m } from 'framer-motion';
import { useRef, useState } from 'react';

import { copy } from '@/content/copy';

import { Parallax, PulseEcg } from './Cinema';
import { fmt } from './format';
import { Icon } from './icons';
import { EASE, useAutoplay } from './motion';
import { Photo, PhotoCredit } from './Photo';
import { Rolling } from './Rolling';

import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

/** Ahead-of-you counts the patient glimpse walks through, then starts again. */
const AHEAD = [3, 2, 1] as const;

/**
 * The hero's picture: the Padma Bridge — a connection the whole country
 * recognises — with two small, abstract glimpses of MedLiveBD laid over it, a
 * hospital and a patient, joined by a heartbeat. A glimpse, not a manual:
 * bars instead of names, no workflow, demonstration figures.
 */
export function HeroVisual({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  const v = t.heroVisual;
  const root = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const auto = useAutoplay(root, 3200, () => {
    setIndex((value) => (value + 1) % AHEAD.length);
  });
  const ahead = AHEAD[index] ?? 2;

  return (
    <figure className="hv" ref={root}>
      <div className="hv-stage">
        <m.div
          className="hv-photo"
          initial={{ opacity: 0, scale: 1.06 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.6, ease: EASE }}
        >
          <Parallax className="hv-parallax" distance={28} zoom={0.04}>
            <Photo
              name="padma"
              alt={v.alt}
              sizes="(max-width: 1120px) 92vw, 560px"
              priority
              position="55% 82%"
            />
          </Parallax>
          <i className="hv-shade" aria-hidden="true" />
          <PhotoCredit name="padma" label={t.photoCredit} />
        </m.div>

        <m.div
          className="glimpse glimpse-hospital"
          aria-hidden="true"
          initial={{ opacity: 0, y: 30, x: -20 }}
          animate={{ opacity: 1, y: 0, x: 0 }}
          transition={{ duration: 1.1, delay: 0.5, ease: EASE }}
        >
          <span className="glimpse-head">
            <span className="glimpse-icon">
              <Icon name="desk" />
            </span>
            {v.hospital}
            <em className="glimpse-live">
              <span className="live-dot" />
              {t.glimpse.live}
            </em>
          </span>
          <strong>{v.hospitalState}</strong>
          <span className="glimpse-rows">
            {[0.82, 0.64, 0.74].map((width, row) => (
              <span key={width} className="glimpse-row">
                <i className={`glimpse-avatar a${String(row)}`} />
                <span className="glimpse-bars">
                  <i style={{ width: `${String(width * 100)}%` }} />
                  <i style={{ width: `${String(width * 55)}%` }} />
                </span>
                <em className={row === 2 ? 'pill pill-quiet' : 'pill'}>
                  {row === 2 ? fmt(12, locale) : v.inSession}
                </em>
              </span>
            ))}
          </span>
          <span className="glimpse-beds">
            <small>{t.glimpse.beds}</small>
            <span className="bed-strip">
              <i className="s-free" />
              <i className="s-busy" />
              <i className="s-held" />
            </span>
          </span>
        </m.div>

        <PulseEcg className="hv-ecg" playing={auto.playing} />

        <m.div
          className="glimpse glimpse-patient"
          aria-hidden="true"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.1, delay: 0.75, ease: EASE }}
        >
          <span className="glimpse-head">
            <span className="glimpse-icon">
              <Icon name="phone" />
            </span>
            {v.patient}
          </span>
          <span className="glimpse-serial">
            <small>{v.yourSerial}</small>
            <b>{fmt(9, locale)}</b>
          </span>
          <span className="glimpse-ahead">
            <Rolling value={ahead} locale={locale} />
            {locale === 'bn' ? '' : ' '}
            {v.ahead}
          </span>
          <span className="glimpse-progress">
            <m.i
              initial={false}
              animate={{ scaleX: (AHEAD.length - index) / (AHEAD.length + 1) + 0.15 }}
              transition={{ duration: 0.9, ease: EASE }}
            />
          </span>
          <span className="glimpse-fresh">
            <span className="live-dot" />
            {v.updated}
          </span>
        </m.div>
      </div>
      <figcaption>
        {auto.reduced ? null : (
          <button
            type="button"
            className="stage-toggle"
            onClick={auto.toggle}
            aria-label={auto.playing ? t.pause : t.play}
          >
            <Icon name={auto.playing ? 'pause' : 'play'} />
          </button>
        )}
        <span>{v.caption}</span>
      </figcaption>
    </figure>
  );
}
