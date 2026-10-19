'use client';

import { m, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';

import { MAP_CITIES, MAP_DIVISIONS, MAP_OUTLINE, MAP_VIEWBOX } from '@/content/bangladesh-map';
import { copy } from '@/content/copy';

import { useCinema, useMotionWelcome } from '../scroll';

/*
 * Lines from Dhaka to each division headquarters — eight divisions, one
 * network, as an ambition. Geographic points only: no hospitals, no coverage,
 * and the page says so beside the map.
 */
const HUB = MAP_CITIES.find((city) => city.key === 'dhaka') ?? {
  key: 'dhaka',
  en: 'Dhaka',
  bn: 'ঢাকা',
  x: 508,
  y: 664,
};
/** Drawn clockwise from the north-west, so the network sweeps around the country. */
const SPOKES = MAP_CITIES.filter((city) => city.key !== 'dhaka')
  .map((city) => ({ city, angle: Math.atan2(city.y - HUB.y, city.x - HUB.x) }))
  .sort(
    (a, b) =>
      ((a.angle + Math.PI * 1.25) % (Math.PI * 2)) - ((b.angle + Math.PI * 1.25) % (Math.PI * 2)),
  )
  .map(({ city }) => {
    const dx = city.x - HUB.x;
    const dy = city.y - HUB.y;
    const bow = 0.16;
    const cx = HUB.x + dx / 2 - dy * bow;
    const cy = HUB.y + dy / 2 + dx * bow;
    return {
      ...city,
      d: `M${String(HUB.x)} ${String(HUB.y)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${String(city.x)} ${String(city.y)}`,
    };
  });
/** Labels sit beside their point, away from the line's approach. */
const LABEL_SIDE = {
  rajshahi: 'start',
  khulna: 'end',
  rangpur: 'start',
  mymensingh: 'start',
  sylhet: 'end',
  barishal: 'start',
  chattogram: 'start',
};

function Spoke({ spoke, index, progress, enabled, locale }) {
  const start = 0.4 + index * 0.05;
  const draw = useTransform(progress, [start, start + 0.14], [0, 1]);
  const arrive = useTransform(progress, [start + 0.1, start + 0.16], [0, 1]);
  const side = LABEL_SIDE[spoke.key] ?? 'start';
  return (
    <g>
      <m.path
        d={spoke.d}
        className="map-spoke"
        data-scrub=""
        style={enabled ? { pathLength: draw } : {}}
      />
      <m.g data-scrub="" style={enabled ? { opacity: arrive } : {}}>
        <circle cx={spoke.x} cy={spoke.y} r="8" className="map-point" />
        <text
          x={spoke.x + (side === 'start' ? 20 : -20)}
          y={spoke.y + 9}
          textAnchor={side}
          className="map-label"
        >
          {spoke[locale]}
        </text>
      </m.g>
    </g>
  );
}

/** The country, its divisions and the vision's lines, driven by `progress` (0–1). */
function CountryMap({ locale, progress: p, lines, camera }) {
  const t = copy[locale].vision;
  const scale = useTransform(p, [0, 0.5], [1.5, 1]);
  const trace = useTransform(p, [0, 0.38], [0, 1]);
  const divisions = useTransform(p, [0.22, 0.42], [0, 1]);
  const hub = useTransform(p, [0, 0.08], [0, 1]);
  return (
    <m.svg
      viewBox={MAP_VIEWBOX}
      role="img"
      aria-label={t.alt}
      className="vision-map"
      data-scrub=""
      style={camera ? { scale, transformOrigin: '50.8% 47.2%' } : {}}
    >
      <defs>
        <radialGradient id="country-fill" cx="0.508" cy="0.472" r="0.65">
          <stop offset="0" stopColor="var(--map-fill-hi)" />
          <stop offset="1" stopColor="var(--map-fill)" />
        </radialGradient>
      </defs>
      <path d={MAP_OUTLINE} fill="url(#country-fill)" className="map-base" />
      <m.g data-scrub="" style={lines ? { opacity: divisions } : {}}>
        {MAP_DIVISIONS.map((division) => (
          <path key={division.key} d={division.d} className="map-division" />
        ))}
      </m.g>
      <m.path
        d={MAP_OUTLINE}
        className="map-outline"
        data-scrub=""
        style={lines ? { pathLength: trace } : {}}
      />
      {SPOKES.map((spoke, index) => (
        <Spoke
          key={spoke.key}
          spoke={spoke}
          index={index}
          progress={p}
          enabled={lines}
          locale={locale}
        />
      ))}
      <m.g data-scrub="" style={lines ? { opacity: hub } : {}}>
        <circle cx={HUB.x} cy={HUB.y} r="30" className="map-hub-halo" />
        <circle cx={HUB.x} cy={HUB.y} r="12" className="map-hub" />
        <text x={HUB.x - 24} y={HUB.y - 26} textAnchor="end" className="map-label map-label-hub">
          {HUB[locale]}
        </text>
      </m.g>
    </m.svg>
  );
}

/**
 * Built for Bangladesh (S-C-01): the page's camera moment. On large screens
 * the scene holds while the reader scrolls (sticky, never hijacked): the view
 * starts close on Dhaka and pulls back as the country's outline is traced,
 * then the vision reaches each division. Elsewhere it simply draws as it
 * arrives; with reduced motion it is complete and still.
 */
export function Vision({ locale }) {
  const t = copy[locale].vision;
  const target = useRef(null);
  const lines = useMotionWelcome();
  const cinema = useCinema();
  // Two trackers, one per layout; the map remounts when the layout changes.
  const pinned = useScroll({ target, offset: ['start start', 'end end'] });
  const passing = useScroll({ target, offset: ['start 0.85', 'start 0.05'] });
  return (
    <section
      id="bangladesh"
      className="vision"
      ref={target}
      aria-labelledby="vision-title"
      data-pinned={cinema}
    >
      <div className="vision-stage">
        <div className="shell vision-layout">
          <div className="vision-copy">
            <p className="eyebrow eyebrow-teal">{t.label}</p>
            <h2 id="vision-title" className="display-l">
              {t.title}
            </h2>
            <p className="lead">{t.body}</p>
            <ul className="vision-points">
              {t.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <p className="vision-note">
              <span className="vision-note-mark" aria-hidden="true" />
              {t.note}
            </p>
          </div>
          <figure className="vision-figure">
            <CountryMap
              key={cinema ? 'pinned' : 'passing'}
              locale={locale}
              progress={cinema ? pinned.scrollYProgress : passing.scrollYProgress}
              lines={lines}
              camera={cinema}
            />
            <figcaption>{t.credit}</figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
