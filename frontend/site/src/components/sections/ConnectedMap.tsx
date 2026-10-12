'use client';

import { m, useInView, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useEffect, useRef } from 'react';

import {
  MAP_CITIES,
  MAP_DISTRICTS,
  MAP_DIVISIONS,
  MAP_OUTLINE,
  MAP_VIEWBOX,
} from '@/content/bangladesh-map';
import { copy } from '@/content/copy';

import { fmt } from '../format';
import { Icon } from '../icons';
import { EASE, Reveal } from '../motion';

import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

const HUB = MAP_CITIES.find((city) => city.key === 'dhaka') ?? { x: 508, y: 664 };
const SPOKES = MAP_CITIES.filter((city) => city.key !== 'dhaka');

/** A gentle arc from Dhaka to a division headquarters, bowed to one side. */
function arc(x: number, y: number): string {
  const mx = (HUB.x + x) / 2;
  const my = (HUB.y + y) / 2;
  const dx = x - HUB.x;
  const dy = y - HUB.y;
  const bow = 0.22;
  return `M${String(HUB.x)} ${String(HUB.y)} Q${String(Math.round(mx - dy * bow))} ${String(Math.round(my + dx * bow))} ${String(x)} ${String(y)}`;
}

const VIEW = { once: true, margin: '0px 0px -20% 0px' } as const;

/**
 * Connected Bangladesh: the country drawn from official boundary data, and
 * our vision of care connected across its eight divisions — a concept, not a
 * coverage map (owner, 12 October 2026).
 */
export function ConnectedMap({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  const section = useRef<HTMLElement>(null);
  const reduced = useReducedMotion() ?? false;
  const { scrollYProgress } = useScroll({ target: section, offset: ['start end', 'end start'] });
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], [0.9, 1.02, 1.08]);
  const y = useTransform(scrollYProgress, [0, 1], [50, -50]);
  const camera = reduced ? {} : { scale, y };
  // The pulses travel once the map is on screen — a few times, then the map rests.
  const svg = useRef<SVGSVGElement>(null);
  const seen = useInView(svg, { once: true, amount: 0.35 });
  useEffect(() => {
    if (!seen || reduced) return;
    svg.current?.querySelectorAll('animateMotion').forEach((motion, index) => {
      motion.beginElementAt(2.6 + index * 0.35);
    });
  }, [seen, reduced]);

  return (
    <section
      className="map-section dark-band section-space"
      id="bangladesh"
      ref={section}
      aria-labelledby="map-heading"
    >
      <div className="map-glow" aria-hidden="true" />
      <div className="shell map-layout">
        <div className="map-copy">
          <Reveal className="section-head">
            <p className="eyebrow">{t.mapLabel}</p>
            <h2 id="map-heading">{t.mapTitle}</h2>
            <p className="body-large">{t.mapBody}</p>
          </Reveal>
          <Reveal className="map-legend" delay={0.1}>
            <span className="concept-chip">
              <Icon name="sparkle" />
              {t.mapConcept}
            </span>
            <p>{t.mapLegend}</p>
            <span className="map-count">
              <b>{fmt(8, locale)}</b> {t.mapDivisions}
            </span>
            <small>{t.mapCredit}</small>
          </Reveal>
        </div>
        <div className="map-frame">
          <m.div className="map-camera" style={camera}>
            <svg
              ref={svg}
              className="bd-map"
              viewBox={MAP_VIEWBOX}
              role="img"
              aria-label={t.mapAria}
            >
              <defs>
                <linearGradient id="land" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" style={{ stopColor: 'var(--navy-3)' }} />
                  <stop offset="100%" style={{ stopColor: 'var(--navy-2)' }} />
                </linearGradient>
                <linearGradient id="spoke" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" style={{ stopColor: 'var(--teal-light)' }} />
                  <stop offset="100%" style={{ stopColor: 'var(--blue-bright)' }} />
                </linearGradient>
                <radialGradient id="hub-glow">
                  <stop offset="0%" style={{ stopColor: 'var(--teal)', stopOpacity: 0.55 }} />
                  <stop offset="100%" style={{ stopColor: 'var(--teal)', stopOpacity: 0 }} />
                </radialGradient>
              </defs>
              <m.path
                d={MAP_OUTLINE}
                className="bd-land"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={VIEW}
                transition={{ duration: 1.4, ease: EASE }}
              />
              <m.path
                d={MAP_DISTRICTS}
                className="bd-districts"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={VIEW}
                transition={{ duration: 1.6, delay: 0.9 }}
              />
              {MAP_DIVISIONS.map((division, index) => (
                <m.path
                  key={division.key}
                  d={division.d}
                  className="bd-division"
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={VIEW}
                  transition={{ duration: 0.9, delay: 0.6 + index * 0.08 }}
                />
              ))}
              <m.path
                d={MAP_OUTLINE}
                className="bd-outline"
                initial={{ pathLength: 0 }}
                whileInView={{ pathLength: 1 }}
                viewport={VIEW}
                transition={{ duration: 2.6, ease: [0.45, 0, 0.2, 1] }}
              />
              <circle cx={HUB.x} cy={HUB.y} r="150" fill="url(#hub-glow)" className="bd-hub-glow" />
              {SPOKES.map((city, index) => {
                const d = arc(city.x, city.y);
                return (
                  <g key={city.key}>
                    <m.path
                      d={d}
                      className="bd-spoke"
                      initial={{ pathLength: 0, opacity: 0 }}
                      whileInView={{ pathLength: 1, opacity: 1 }}
                      viewport={VIEW}
                      transition={{ duration: 1.2, delay: 1.8 + index * 0.12, ease: EASE }}
                    />
                    {reduced ? null : (
                      <circle r="5" className="bd-pulse">
                        <animateMotion
                          dur="2.6s"
                          begin="indefinite"
                          repeatCount="3"
                          path={d}
                          fill="freeze"
                        />
                      </circle>
                    )}
                  </g>
                );
              })}
              {MAP_CITIES.map((city, index) => {
                const hub = city.key === 'dhaka';
                return (
                  <m.g
                    key={city.key}
                    className={hub ? 'bd-city is-hub' : 'bd-city'}
                    initial={{ opacity: 0, scale: 0.4 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={VIEW}
                    transition={{ duration: 0.6, delay: 1.6 + index * 0.1, ease: EASE }}
                    style={{ transformOrigin: `${String(city.x)}px ${String(city.y)}px` }}
                  >
                    {hub ? <circle cx={city.x} cy={city.y} r="22" className="bd-ring" /> : null}
                    <circle cx={city.x} cy={city.y} r={hub ? 11 : 7} className="bd-dot" />
                    <text x={city.x + (hub ? 26 : 16)} y={city.y + 9} className="bd-label">
                      {locale === 'bn' ? city.bn : city.en}
                    </text>
                  </m.g>
                );
              })}
            </svg>
          </m.div>
          <span className="map-badge" aria-hidden="true">
            <Icon name="sparkle" />
            {t.mapConcept}
          </span>
        </div>
      </div>
    </section>
  );
}
