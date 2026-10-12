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
import type { ReactNode, RefObject } from 'react';

/*
 * Motion ownership (GR-06). Every animated element has exactly one owner: the
 * scroll progress of the section it sits in, mapped straight to transform,
 * opacity or SVG path length. No springs on scroll — the picture moves with
 * the visitor's hand, never behind it. Nothing is pinned. Text and actions
 * never depend on scroll position to be visible.
 *
 * Two gates:
 * - `useMotionWelcome`: the visitor has not asked for reduced motion. Lines draw.
 * - `useDesktopCinema`: additionally a large screen. Photographs drift.
 * Without script, or with reduced motion, every line is fully drawn and every
 * photograph is still.
 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => {
      setMatches(list.matches);
    };
    update();
    list.addEventListener('change', update);
    return () => {
      list.removeEventListener('change', update);
    };
  }, [query]);
  return matches;
}
const useMotionWelcome = (): boolean => useMediaQuery('(prefers-reduced-motion: no-preference)');
const useDesktopCinema = (): boolean =>
  useMediaQuery(
    '(min-width: 961px) and (min-height: 650px) and (prefers-reduced-motion: no-preference)',
  );

/** Width of an element, updated on resize only (never on scroll). */
function useWidth(target: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [target]);
  return width;
}

function Demo({ locale }: { readonly locale: Locale }): ReactNode {
  return (
    <a href={demoHref} className="button button-primary">
      {copy[locale].demo}
      <Icon name="diagonal" className="arrow" />
    </a>
  );
}

/** A vertical length of the care thread, drawn downward by `draw` (0–1). */
function Thread({
  draw,
  enabled,
  className,
}: {
  readonly draw: MotionValue<number>;
  readonly enabled: boolean;
  readonly className: string;
}): ReactNode {
  return (
    <span className={`thread ${className}`} aria-hidden="true">
      <m.span className="thread-ink" style={enabled ? { scaleY: draw } : {}} />
    </span>
  );
}

export function HumanHero({ locale }: { readonly locale: Locale }): ReactNode {
  const t = cinematic[locale];
  const target = useRef<HTMLElement>(null);
  const cinema = useDesktopCinema();
  const { scrollYProgress: p } = useScroll({ target, offset: ['start start', 'end start'] });
  const y = useTransform(p, [0, 1], ['0%', '14%']);
  const scale = useTransform(p, [0, 1], [1.02, 1.08]);
  const lift = useTransform(p, [0, 1], [0, -70]);
  const fade = useTransform(p, [0.45, 0.95], [1, 0]);
  return (
    <section className="pulse-hero" ref={target} aria-labelledby="hero-title" data-motion={cinema}>
      <m.div className="hero-photograph" style={cinema ? { y, scale } : {}}>
        <CampaignImage
          name="hero"
          alt={t.heroAlt}
          priority
          sizes="(max-width: 960px) 1100px, 100vw"
        />
      </m.div>
      <div className="hero-shade" />
      <m.div className="shell pulse-hero-content" style={cinema ? { y: lift, opacity: fade } : {}}>
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
        <div className="pulse-actions">
          <Demo locale={locale} />
          <a href="#vision" className="pulse-text-link">
            {t.explore}
            <Icon name="arrow" className="arrow" />
          </a>
        </div>
      </m.div>
      <a className="hero-cue" href="#vision">
        <span>{t.scroll}</span>
        <span className="hero-cue-line" aria-hidden="true" />
      </a>
    </section>
  );
}

/**
 * The care thread begins under the hero's scroll cue, runs through the
 * statement and leads into the platform node of the next scene.
 */
export function Connection({ locale }: { readonly locale: Locale }): ReactNode {
  const t = cinematic[locale];
  const target = useRef<HTMLElement>(null);
  const enabled = useMotionWelcome();
  const { scrollYProgress: p } = useScroll({ target, offset: ['start 0.9', 'end 0.55'] });
  const upper = useTransform(p, [0, 0.35], [0, 1]);
  const lower = useTransform(p, [0.55, 1], [0, 1]);
  return (
    <section
      id="vision"
      className="pulse-connection"
      ref={target}
      aria-labelledby="connection-title"
    >
      <Thread draw={upper} enabled={enabled} className="thread-top" />
      <div className="shell connection-copy">
        <p className="pulse-kicker">{t.chapter}</p>
        <h2 id="connection-title">
          {t.connection}
          <br />
          <span>{t.connectionAccent}</span>
        </h2>
        <p>{t.connectionNote}</p>
      </div>
      <Thread draw={lower} enabled={enabled} className="thread-bottom" />
    </section>
  );
}

const FORK_HEIGHT = 100;
/** The two branches from the platform node to the top of each scene, sized to the layout. */
function forkPaths(width: number): readonly [string, string] {
  const mid = width / 2;
  const r = 26;
  const bend = 58;
  const drop = FORK_HEIGHT;
  const left = width * 0.25;
  const right = width * 0.75;
  return [
    `M${mid} 0V${bend - r}Q${mid} ${bend} ${mid - r} ${bend}H${left + r}Q${left} ${bend} ${left} ${bend + r}V${drop}`,
    `M${mid} 0V${bend - r}Q${mid} ${bend} ${mid + r} ${bend}H${right - r}Q${right} ${bend} ${right} ${bend + r}V${drop}`,
  ];
}

function Feature({ title, body }: { readonly title: string; readonly body: string }): ReactNode {
  return (
    <li>
      <h4>{title}</h4>
      <p>{body}</p>
    </li>
  );
}

/**
 * Hospitals and patients, each with its own photograph — shown once — and the
 * few things MedLiveBD does for them. One platform node branches to both.
 */
export function AudienceStage({ locale }: { readonly locale: Locale }): ReactNode {
  const t = cinematic[locale];
  const target = useRef<HTMLElement>(null);
  const fork = useRef<HTMLDivElement>(null);
  const width = useWidth(fork);
  const enabled = useMotionWelcome();
  const cinema = useDesktopCinema();
  const { scrollYProgress: p } = useScroll({ target, offset: ['start 0.75', 'start 0.05'] });
  const branch = useTransform(p, [0.2, 0.75], [0, 1]);
  const node = useTransform(p, [0, 0.2], [0.86, 1]);
  const settle = useTransform(p, [0.1, 1], [1.12, 1]);
  const rise = useTransform(p, [0.1, 1], [80, 0]);
  const riseLate = useTransform(p, [0.1, 1], [130, 0]);
  // Before measurement (and without script) the fork is drawn at the shell's width and stretched.
  const drawWidth = width > 0 ? width : 1240;
  const [toHospital, toPatient] = forkPaths(drawWidth);
  return (
    <section
      id="experiences"
      className="pulse-audiences"
      ref={target}
      aria-labelledby="audience-title"
      data-motion={cinema}
      data-lines={enabled}
    >
      <div className="shell">
        <div className="audience-hub" aria-hidden="true">
          <m.span className="hub-node" style={enabled ? { scale: node } : {}}>
            <span className="hub-dot" />
            {t.hub}
          </m.span>
        </div>
        <h2 id="audience-title" className="audience-title">
          {t.experiences}
        </h2>
        <div className="audience-fork" ref={fork} aria-hidden="true">
          <svg
            viewBox={`0 0 ${String(drawWidth)} ${String(FORK_HEIGHT)}`}
            width={width > 0 ? width : '100%'}
            height={FORK_HEIGHT}
            preserveAspectRatio={width > 0 ? 'xMidYMid meet' : 'none'}
          >
            {[toHospital, toPatient].map((d) => (
              <g key={d}>
                <path d={d} className="fork-track" />
                <m.path d={d} className="fork-ink" style={enabled ? { pathLength: branch } : {}} />
              </g>
            ))}
          </svg>
        </div>
        <div className="audience-grid">
          <m.article
            id="hospitals"
            className="audience-card"
            aria-labelledby="hospital-title"
            style={cinema ? { y: rise } : {}}
          >
            <div className="audience-photo">
              <m.div className="audience-photo-inner" style={cinema ? { scale: settle } : {}}>
                <CampaignImage
                  name="team"
                  alt={t.teamAlt}
                  sizes="(max-width: 960px) 100vw, 620px"
                />
              </m.div>
              <div className="audience-shade" />
              <div className="audience-copy">
                <p className="pulse-kicker">{t.hospital}</p>
                <h3 id="hospital-title">{t.hospitalTitle}</h3>
              </div>
            </div>
            <ul className="feature-list">
              {t.hospitalFeatures.map(([title, body]) => (
                <Feature key={title} title={title} body={body} />
              ))}
            </ul>
            <div className="audience-action">
              <Demo locale={locale} />
            </div>
          </m.article>
          <m.article
            id="patients"
            className="audience-card"
            aria-labelledby="patient-title"
            style={cinema ? { y: riseLate } : {}}
          >
            <div className="audience-photo">
              <m.div className="audience-photo-inner" style={cinema ? { scale: settle } : {}}>
                <CampaignImage
                  name="patient"
                  alt={t.patientAlt}
                  sizes="(max-width: 960px) 100vw, 620px"
                />
              </m.div>
              <div className="audience-shade" />
              <div className="audience-copy">
                <p className="pulse-kicker">{t.patient}</p>
                <h3 id="patient-title">{t.patientTitle}</h3>
              </div>
            </div>
            <ul className="feature-list">
              {t.patientFeatures.map(([title, body]) => (
                <Feature key={title} title={title} body={body} />
              ))}
            </ul>
            <div className="audience-action">
              <p className="patient-status">
                <span className="status-dot" aria-hidden="true" />
                <strong>{t.comingSoon}</strong>
                <span>{t.patientStatus}</span>
              </p>
            </div>
          </m.article>
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
          <figcaption>{t.mapCredit}</figcaption>
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
        <ul className="trust-principles">
          {t.trust.map(([title, body]) => (
            <li key={title}>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ul>
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
