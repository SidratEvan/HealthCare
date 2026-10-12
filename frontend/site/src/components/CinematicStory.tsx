'use client';

import { m, useScroll, useTransform } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

import { MAP_CITIES, MAP_DIVISIONS, MAP_OUTLINE, MAP_VIEWBOX } from '@/content/bangladesh-map';
import { cinematic } from '@/content/cinematic';
import { contactEmail, copy, demoHref } from '@/content/copy';

import { CampaignImage } from './CampaignImage';
import { Icon } from './icons';

import type { Locale } from '@/content/copy';
import type { MotionValue } from 'framer-motion';
import type { ReactNode } from 'react';

/*
 * Motion ownership (GR-06): every animated element is driven by its own
 * section's scroll progress, mapped straight to transform, opacity or SVG path
 * length — no springs, so nothing trails the visitor's hand, and nothing is
 * pinned. Lines draw on every screen unless reduced motion is asked for;
 * photographs drift only on large screens. Without script or with reduced
 * motion, every line is fully drawn and every photograph is still.
 */
function useMediaQuery(query: string): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => {
      setEnabled(list.matches);
    };
    update();
    list.addEventListener('change', update);
    return () => {
      list.removeEventListener('change', update);
    };
  }, [query]);
  return enabled;
}
/** GR-06: start from complete static HTML; enable cinema only on suitable screens. */
const useDesktopCinema = (): boolean =>
  useMediaQuery(
    '(min-width: 961px) and (min-height: 650px) and (prefers-reduced-motion: no-preference)',
  );
const useMotionWelcome = (): boolean => useMediaQuery('(prefers-reduced-motion: no-preference)');

/** A vertical length of the care thread, drawn downward by `draw` (0–1). */
function Stem({
  draw,
  enabled,
  className,
}: {
  readonly draw: MotionValue<number>;
  readonly enabled: boolean;
  readonly className: string;
}): ReactNode {
  return (
    <span className={`connection-stem ${className}`} aria-hidden="true">
      <m.span className="stem-ink" style={enabled ? { scaleY: draw } : {}} />
    </span>
  );
}

function Demo({ locale }: { readonly locale: Locale }): ReactNode {
  return (
    <a href={demoHref} className="button button-primary">
      {copy[locale].demo}
      <Icon name="diagonal" className="arrow" />
    </a>
  );
}

export function HumanHero({ locale }: { readonly locale: Locale }): ReactNode {
  const t = cinematic[locale];
  const target = useRef<HTMLElement>(null);
  const enabled = useDesktopCinema();
  const { scrollYProgress: p } = useScroll({ target, offset: ['start start', 'end start'] });
  const y = useTransform(p, [0, 1], ['0%', '18%']);
  const scale = useTransform(p, [0, 1], [1, 1.06]);
  return (
    <section className="pulse-hero" ref={target} aria-labelledby="hero-title" data-motion={enabled}>
      <m.div className="hero-photograph" style={enabled ? { y, scale } : {}}>
        <CampaignImage
          name="hero"
          alt={t.heroAlt}
          priority
          sizes="(max-width: 960px) 1100px, 100vw"
        />
      </m.div>
      <div className="hero-shade" />
      <div className="shell pulse-hero-content">
        <p className="pulse-kicker">
          <span className="signal-dot" />
          {copy[locale].eyebrow}
        </p>
        <h1 id="hero-title">
          {copy[locale].hero.map((part) => (
            <span className={part.accent ? 'pulse-gradient' : ''} key={part.text}>
              {part.text}
            </span>
          ))}
        </h1>
        <p className="pulse-lead">{t.lead}</p>
        <nav className="hero-doors" aria-label={t.choose}>
          <a href="#hospitals" className="hero-door door-hospital">
            <span className="door-kicker">{t.hospital}</span>
            <span className="door-line">{t.hospitalDoor}</span>
            <Icon name="arrow" className="arrow door-arrow" />
          </a>
          <a href="#patients" className="hero-door door-patient">
            <span className="door-kicker">{t.patient}</span>
            <span className="door-line">{t.patientDoor}</span>
            <Icon name="arrow" className="arrow door-arrow" />
          </a>
        </nav>
      </div>
      <span className="hero-stem" aria-hidden="true" />
      <div className="shell hero-foot">
        <span>{t.chapter}</span>
        <a href="#vision">
          {t.scroll}
          <span aria-hidden="true">↓</span>
        </a>
      </div>
    </section>
  );
}

/** The care thread runs from the hero, through the statement, to the node between the scenes. */
export function Connection({ locale }: { readonly locale: Locale }): ReactNode {
  const t = cinematic[locale];
  const target = useRef<HTMLElement>(null);
  const enabled = useMotionWelcome();
  const { scrollYProgress: p } = useScroll({ target, offset: ['start 0.9', 'end 0.6'] });
  const upper = useTransform(p, [0, 0.35], [0, 1]);
  const lower = useTransform(p, [0.6, 1], [0, 1]);
  return (
    <section
      id="vision"
      className="pulse-connection"
      ref={target}
      aria-labelledby="connection-title"
    >
      <Stem draw={upper} enabled={enabled} className="" />
      <div className="shell connection-copy">
        <p className="pulse-kicker">{t.chapter}</p>
        <h2 id="connection-title">
          {t.connection}
          <br />
          <span>{t.connectionAccent}</span>
        </h2>
        <p>{t.connectionNote}</p>
      </div>
      <Stem draw={lower} enabled={enabled} className="connection-stem-bottom" />
    </section>
  );
}

function Features({
  points,
}: {
  readonly points: readonly (readonly [string, string])[];
}): ReactNode {
  return (
    <ul className="benefit-lines">
      {points.map(([title, body]) => (
        <li key={title}>
          <span className="benefit-dot" aria-hidden="true" />
          <div>
            <h4>{title}</h4>
            <p>{body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Which audience is in the middle of the screen — for the stacked selector only. */
function useCurrentAudience(): 'hospital' | 'patient' {
  const [current, setCurrent] = useState<'hospital' | 'patient'>('hospital');
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting)
            setCurrent(entry.target.id === 'patients' ? 'patient' : 'hospital');
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    for (const id of ['hospitals', 'patients']) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => {
      observer.disconnect();
    };
  }, []);
  return current;
}

/**
 * The audience gateway (owner, 12 October 2026), on Codex's panorama: two
 * unmistakable experiences side by side, each photograph shown once, each with
 * its own heading, colour and action. The MedLiveBD node joins them in the gap
 * between the photographs, never across a face or a line of text. Stacked on a
 * phone, a selector keeps both one tap away. Unpinned: the scenes converge and
 * the bridge draws as they arrive.
 */
export function AudienceStage({ locale }: { readonly locale: Locale }): ReactNode {
  const t = cinematic[locale];
  const target = useRef<HTMLElement>(null);
  const enabled = useDesktopCinema();
  const lines = useMotionWelcome();
  const current = useCurrentAudience();
  const { scrollYProgress: p } = useScroll({ target, offset: ['start 0.85', 'start 0.12'] });
  const left = useTransform(p, [0, 1], ['5%', '0%']);
  const right = useTransform(p, [0, 1], ['-5%', '0%']);
  const stem = useTransform(p, [0.15, 0.6], [0, 1]);
  const bridge = useTransform(p, [0.55, 1], [0, 1]);
  const node = useTransform(p, [0.5, 0.65], [0.6, 1]);
  return (
    <section
      id="experiences"
      className="pulse-audiences"
      ref={target}
      data-motion={enabled}
      data-lines={lines}
      aria-labelledby="audience-title"
    >
      <div className="shell audience-heading">
        <h2 id="audience-title">{t.experiences}</h2>
      </div>
      <nav className="audience-switch" aria-label={t.choose}>
        <div className="audience-switch-inner">
          <a href="#hospitals" aria-current={current === 'hospital' ? 'location' : undefined}>
            {t.hospital}
          </a>
          <a href="#patients" aria-current={current === 'patient' ? 'location' : undefined}>
            {t.patient}
          </a>
        </div>
      </nav>
      <div className="audience-panorama">
        <div id="hospitals" className="audience-column">
          <m.article
            className="audience-scene audience-hospital"
            style={enabled ? { x: left } : {}}
            aria-labelledby="hospital-title"
          >
            <CampaignImage name="team" alt={t.teamAlt} sizes="(max-width: 960px) 100vw, 55vw" />
            <div className="audience-shade" />
            <div className="audience-copy">
              <p className="pulse-kicker">{t.hospital}</p>
              <h3 id="hospital-title">{t.hospitalTitle}</h3>
              <p>{t.hospitalBody}</p>
              <Demo locale={locale} />
            </div>
          </m.article>
          <Features points={t.hospitalFeatures} />
        </div>
        <div className="connection-token" aria-hidden="true">
          <span className="token-stem">
            <m.span className="stem-ink" style={lines ? { scaleY: stem } : {}} />
          </span>
          <span className="token-arm token-arm-left">
            <m.span className="arm-ink" style={lines ? { scaleX: bridge } : {}} />
          </span>
          <span className="token-arm token-arm-right">
            <m.span className="arm-ink" style={lines ? { scaleX: bridge } : {}} />
          </span>
          <m.span className="token-point" style={lines ? { scale: node } : {}} />
          <span className="token-label">{t.hub}</span>
        </div>
        <div id="patients" className="audience-column">
          <m.article
            className="audience-scene audience-patient"
            style={enabled ? { x: right } : {}}
            aria-labelledby="patient-title"
          >
            <CampaignImage
              name="patient"
              alt={t.patientAlt}
              sizes="(max-width: 960px) 100vw, 55vw"
            />
            <div className="audience-shade" />
            <div className="audience-copy">
              <p className="pulse-kicker">{t.patient}</p>
              <h3 id="patient-title">{t.patientTitle}</h3>
              <p>{t.patientBody}</p>
              <a className="button button-light" href="#patient-experience">
                {t.patientCta}
                <Icon name="arrow" className="arrow" />
              </a>
            </div>
          </m.article>
          <div id="patient-experience" role="region" aria-label={t.patientInfo}>
            <Features points={t.patientFeatures} />
            <div className="patient-status">
              <strong>{t.comingSoon}</strong>
              <p>{t.patientStatus}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/*
 * Lines from Dhaka to each division headquarters — eight divisions, one
 * network, as an ambition. Geographic points only: no hospitals, no coverage.
 */
const HUB = MAP_CITIES.find((city) => city.key === 'dhaka') ?? {
  key: 'dhaka',
  en: 'Dhaka',
  bn: 'ঢাকা',
  x: 508,
  y: 664,
};
/** Drawn clockwise from the west, so the network sweeps around the country. */
const SPOKES = MAP_CITIES.filter((city) => city.key !== 'dhaka')
  .map((city) => ({ city, angle: Math.atan2(city.y - HUB.y, city.x - HUB.x) }))
  .sort(
    (a, b) =>
      ((a.angle + Math.PI * 0.9) % (Math.PI * 2)) - ((b.angle + Math.PI * 0.9) % (Math.PI * 2)),
  )
  .map(({ city }) => {
    const dx = city.x - HUB.x;
    const dy = city.y - HUB.y;
    const bow = 0.18;
    const cx = HUB.x + dx / 2 - dy * bow;
    const cy = HUB.y + dy / 2 + dx * bow;
    return {
      ...city,
      d: `M${String(HUB.x)} ${String(HUB.y)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${String(city.x)} ${String(city.y)}`,
    };
  });
/** Labels sit beside their point, away from the lines' approach. */
const LABEL_SIDE: Readonly<Record<string, 'start' | 'end'>> = {
  rajshahi: 'end',
  khulna: 'end',
  rangpur: 'start',
  mymensingh: 'start',
  sylhet: 'end',
  barishal: 'start',
  chattogram: 'start',
};

function Spoke({
  spoke,
  index,
  progress,
  enabled,
  locale,
}: {
  readonly spoke: (typeof SPOKES)[number];
  readonly index: number;
  readonly progress: MotionValue<number>;
  readonly enabled: boolean;
  readonly locale: Locale;
}): ReactNode {
  const start = 0.42 + index * 0.06;
  const draw = useTransform(progress, [start, start + 0.16], [0, 1]);
  const arrive = useTransform(progress, [start + 0.12, start + 0.18], [0, 1]);
  const side = LABEL_SIDE[spoke.key] ?? 'start';
  return (
    <g>
      <m.path d={spoke.d} className="map-spoke" style={enabled ? { pathLength: draw } : {}} />
      <m.g style={enabled ? { opacity: arrive } : {}}>
        <circle cx={spoke.x} cy={spoke.y} r="9" className="map-point" />
        <text
          x={spoke.x + (side === 'start' ? 22 : -22)}
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

export function BangladeshScene({ locale }: { readonly locale: Locale }): ReactNode {
  const t = cinematic[locale];
  const target = useRef<HTMLElement>(null);
  const enabled = useMotionWelcome();
  const cinema = useDesktopCinema();
  const { scrollYProgress: p } = useScroll({ target, offset: ['start 0.85', 'start 0.1'] });
  const scale = useTransform(p, [0, 0.6], [0.94, 1]);
  const trace = useTransform(p, [0, 0.42], [0, 1]);
  const divisions = useTransform(p, [0.22, 0.45], [0, 1]);
  const hub = useTransform(p, [0.34, 0.42], [0, 1]);
  return (
    <section
      id="bangladesh"
      className="pulse-bangladesh"
      ref={target}
      aria-labelledby="bangladesh-title"
      data-motion={cinema}
      data-lines={enabled}
    >
      <div className="shell bangladesh-layout">
        <div className="bangladesh-copy">
          <p className="pulse-kicker">{t.mapLabel}</p>
          <h2 id="bangladesh-title">
            {t.mapTitle}
            <span>{t.mapAccent}</span>
          </h2>
          <p>{t.mapBody}</p>
          <p className="map-honesty">
            <span className="signal-dot" aria-hidden="true" />
            {t.mapNote}
          </p>
        </div>
        <figure className="country-figure">
          <m.svg
            viewBox={MAP_VIEWBOX}
            role="img"
            aria-label={t.mapAlt}
            className="country-map"
            style={cinema ? { scale } : {}}
          >
            <defs>
              <radialGradient id="country-fill" cx="0.5" cy="0.47" r="0.6">
                <stop offset="0" stopColor="var(--map-fill-bright)" />
                <stop offset="1" stopColor="var(--map-fill)" />
              </radialGradient>
            </defs>
            <path d={MAP_OUTLINE} fill="url(#country-fill)" className="country-base" />
            <m.g style={enabled ? { opacity: divisions } : {}}>
              {MAP_DIVISIONS.map((division) => (
                <path key={division.key} d={division.d} className="country-division" />
              ))}
            </m.g>
            <m.path
              d={MAP_OUTLINE}
              className="country-outline"
              style={enabled ? { pathLength: trace } : {}}
            />
            {SPOKES.map((spoke, index) => (
              <Spoke
                key={spoke.key}
                spoke={spoke}
                index={index}
                progress={p}
                enabled={enabled}
                locale={locale}
              />
            ))}
            <m.g style={enabled ? { opacity: hub } : {}}>
              <circle cx={HUB.x} cy={HUB.y} r="34" className="map-hub-halo" />
              <circle cx={HUB.x} cy={HUB.y} r="14" className="map-hub" />
              <text
                x={HUB.x - 26}
                y={HUB.y - 32}
                textAnchor="end"
                className="map-label map-label-hub"
              >
                {HUB[locale]}
              </text>
            </m.g>
          </m.svg>
          <figcaption>
            {t.mapCaption}
            <small>{t.mapCredit}</small>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

export function Responsibility({ locale }: { readonly locale: Locale }): ReactNode {
  const t = cinematic[locale];
  return (
    <section id="trust" className="pulse-trust" aria-labelledby="trust-title">
      <div className="shell">
        <div className="trust-intro">
          <p className="pulse-kicker">{t.trustLabel}</p>
          <h2 id="trust-title">{t.trustTitle}</h2>
        </div>
        <div className="trust-principles">
          {t.trust.map(([title, body]) => (
            <div key={title}>
              <span className="signal-dot" />
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
        <a className="pulse-text-link" href={`/${locale}/privacy`}>
          {copy[locale].privacy}
          <Icon name="arrow" className="arrow" />
        </a>
      </div>
    </section>
  );
}

export function ClosingInvitation({ locale }: { readonly locale: Locale }): ReactNode {
  const t = cinematic[locale];
  return (
    <section id="contact" className="pulse-closing" aria-labelledby="contact-title">
      <CampaignImage name="atmosphere" alt={t.atmosphereAlt} />
      <div className="closing-shade" />
      <div className="shell closing-content">
        <p className="pulse-kicker">{copy[locale].contactLabel}</p>
        <h2 id="contact-title">{t.contactTitle}</h2>
        <p>{t.contactBody}</p>
        <div className="pulse-actions">
          <Demo locale={locale} />
          <a className="pulse-text-link" href={`mailto:${contactEmail}`}>
            {contactEmail}
            <Icon name="diagonal" className="arrow" />
          </a>
        </div>
        <span className="email-hint">{t.emailHint}</span>
        <a className="closing-founders" href={`/${locale}/founders`}>
          {t.foundersLink}
          <Icon name="arrow" className="arrow" />
        </a>
      </div>
    </section>
  );
}
