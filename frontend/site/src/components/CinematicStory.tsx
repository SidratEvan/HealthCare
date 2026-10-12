'use client';

import { m, useScroll, useSpring, useTransform } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

import { MAP_OUTLINE, MAP_VIEWBOX, MAP_DIVISIONS } from '@/content/bangladesh-map';
import { cinematic } from '@/content/cinematic';
import { contactEmail, copy, demoHref } from '@/content/copy';

import { CampaignImage } from './CampaignImage';
import { Icon } from './icons';

import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

/** GR-06: start from complete static HTML; enable cinema only on suitable screens. */
function useDesktopCinema(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(
      '(min-width: 961px) and (min-height: 650px) and (prefers-reduced-motion: no-preference)',
    );
    const update = (): void => {
      setEnabled(query.matches);
    };
    update();
    query.addEventListener('change', update);
    return () => {
      query.removeEventListener('change', update);
    };
  }, []);
  return enabled;
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
  const { scrollYProgress } = useScroll({ target, offset: ['start start', 'end start'] });
  const p = useSpring(scrollYProgress, { stiffness: 240, damping: 30 });
  const y = useTransform(p, [0, 1], ['0%', '18%']);
  const scale = useTransform(p, [0, 1], [1, 1.06]);
  const line = useTransform(p, [0, 0.65], [0.42, 1]);
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
        <div className="pulse-actions">
          <Demo locale={locale} />
          <a href="#vision" className="pulse-text-link">
            {t.explore}
            <Icon name="arrow" className="arrow" />
          </a>
        </div>
      </div>
      <svg
        className="hero-signal"
        viewBox="0 0 1440 800"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M1110 370 C1270 430 1200 600 1000 615 S720 660 720 800" className="signal-track" />
        <m.path
          d="M1110 370 C1270 430 1200 600 1000 615 S720 660 720 800"
          className="signal-stroke"
          style={enabled ? { pathLength: line } : {}}
        />
        <circle cx="1110" cy="370" r="5" className="signal-point" />
      </svg>
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

export function Connection({ locale }: { readonly locale: Locale }): ReactNode {
  const t = cinematic[locale];
  return (
    <section id="vision" className="pulse-connection" aria-labelledby="connection-title">
      <div className="connection-stem" aria-hidden="true" />
      <div className="shell connection-copy">
        <p className="pulse-kicker">{t.chapter}</p>
        <h2 id="connection-title">
          {t.connection}
          <br />
          <span>{t.connectionAccent}</span>
        </h2>
        <p>{t.connectionNote}</p>
      </div>
      <div className="connection-stem connection-stem-bottom" aria-hidden="true" />
    </section>
  );
}

/** One progress owner choreographs separation, the central layers and reconnection. */
export function AudienceStage({ locale }: { readonly locale: Locale }): ReactNode {
  const t = cinematic[locale];
  const target = useRef<HTMLElement>(null);
  const enabled = useDesktopCinema();
  const [focus, setFocus] = useState<'both' | 'hospital' | 'patient'>('both');
  const { scrollYProgress } = useScroll({ target, offset: ['start 0.18', 'end 0.9'] });
  const p = useSpring(scrollYProgress, { stiffness: 260, damping: 32, restDelta: 0.001 });
  const left = useTransform(p, [0, 0.5, 1], ['6%', '-2%', '0%']);
  const right = useTransform(p, [0, 0.5, 1], ['-6%', '2%', '0%']);
  const turn = useTransform(p, [0, 0.5, 1], [-28, 24, 0]);
  const upper = useTransform(p, [0, 0.5, 1], [-12, -88, -28]);
  const lower = useTransform(p, [0, 0.5, 1], [12, 88, 28]);
  const trace = useTransform(p, [0, 0.65, 1], [0.12, 0.7, 1]);
  return (
    <section
      id="experiences"
      className="pulse-audiences"
      ref={target}
      data-motion={enabled}
      data-focus={focus}
      aria-labelledby="audience-title"
    >
      <div className="audience-sticky">
        <div className="shell audience-heading">
          <h2 id="audience-title">{t.experiences}</h2>
          <div className="audience-controls" role="group" aria-label={t.focus}>
            {(['hospital', 'both', 'patient'] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={focus === value}
                onClick={() => {
                  setFocus(value);
                }}
              >
                {value === 'both' ? t.reset : t[value]}
              </button>
            ))}
          </div>
        </div>
        <div className="audience-panorama">
          <m.article
            className="audience-scene audience-hospital"
            style={enabled ? { x: left } : {}}
          >
            <CampaignImage name="team" alt={t.teamAlt} sizes="(max-width: 960px) 100vw, 55vw" />
            <div className="audience-shade" />
            <div className="audience-copy">
              <p className="pulse-kicker">{t.hospital}</p>
              <h3>{t.hospitalTitle}</h3>
              <p>{t.hospitalBody}</p>
              <Demo locale={locale} />
            </div>
          </m.article>
          <div className="connection-token" aria-hidden="true">
            <svg viewBox="0 0 320 400" className="token-lines">
              <path
                d="M160 0V105 M0 210C90 210 88 180 160 180S225 210 320 210 M160 275V400"
                className="signal-track"
              />
              <m.path
                d="M160 0V105 M0 210C90 210 88 180 160 180S225 210 320 210 M160 275V400"
                className="signal-stroke"
                style={enabled ? { pathLength: trace } : {}}
              />
            </svg>
            <m.div
              className="token-layer layer-one"
              style={enabled ? { y: upper, rotate: turn } : {}}
            />
            <m.div className="token-layer layer-two" style={enabled ? { rotate: turn } : {}} />
            <m.div
              className="token-layer layer-three"
              style={enabled ? { y: lower, rotate: turn } : {}}
            />
            <span className="token-point" />
          </div>
          <m.article
            className="audience-scene audience-patient"
            style={enabled ? { x: right } : {}}
          >
            <CampaignImage
              name="patient"
              alt={t.patientAlt}
              sizes="(max-width: 960px) 100vw, 55vw"
            />
            <div className="audience-shade" />
            <div className="audience-copy">
              <p className="pulse-kicker">{t.patient}</p>
              <h3>{t.patientTitle}</h3>
              <p>{t.patientBody}</p>
              <a className="button button-light" href="#patients">
                {t.patientCta}
                <Icon name="arrow" className="arrow" />
              </a>
            </div>
          </m.article>
        </div>
        <div className="audience-caption">
          <span className="signal-dot" />
          {t.together}
        </div>
      </div>
    </section>
  );
}

export function PeopleStories({ locale }: { readonly locale: Locale }): ReactNode {
  const t = cinematic[locale];
  return (
    <>
      <section
        id="hospitals"
        className="people-story hospital-story"
        aria-labelledby="hospital-title"
      >
        <div className="shell people-grid">
          <div className="people-photo">
            <CampaignImage name="team" alt={t.teamAlt} sizes="(max-width: 960px) 100vw, 52vw" />
            <span className="photo-edge" aria-hidden="true" />
          </div>
          <div className="people-copy">
            <p className="pulse-kicker">{t.hospital}</p>
            <h2 id="hospital-title">{t.hospitalDetail}</h2>
            <p>{t.hospitalDetailBody}</p>
            <ul className="benefit-lines">
              {t.hospitalBenefits.map(([title, body]) => (
                <li key={title}>
                  <span className="benefit-dot" aria-hidden="true" />
                  <div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Demo locale={locale} />
          </div>
        </div>
      </section>
      <section id="patients" className="people-story patient-story" aria-labelledby="patient-title">
        <div className="shell people-grid">
          <div className="people-copy">
            <p className="pulse-kicker">{t.patient}</p>
            <h2 id="patient-title">{t.patientDetail}</h2>
            <p>{t.patientDetailBody}</p>
            <ul className="patient-steps">
              {t.patientBenefits.map((text) => (
                <li key={text}>
                  <span className="benefit-dot" aria-hidden="true" />
                  {text}
                </li>
              ))}
            </ul>
            <div className="patient-status">
              <strong>{t.comingSoon}</strong>
              <p>{t.patientStatus}</p>
            </div>
          </div>
          <div className="people-photo">
            <CampaignImage
              name="patient"
              alt={t.patientAlt}
              sizes="(max-width: 960px) 100vw, 52vw"
            />
            <span className="photo-edge" aria-hidden="true" />
          </div>
        </div>
      </section>
    </>
  );
}

export function BangladeshScene({ locale }: { readonly locale: Locale }): ReactNode {
  const t = cinematic[locale];
  const target = useRef<HTMLElement>(null);
  const enabled = useDesktopCinema();
  const { scrollYProgress } = useScroll({ target, offset: ['start 0.85', 'center 0.4'] });
  const p = useSpring(scrollYProgress, { stiffness: 220, damping: 30 });
  const scale = useTransform(p, [0, 1], [0.88, 1]);
  const trace = useTransform(p, [0, 0.8], [0, 1]);
  const connections = useTransform(p, [0.35, 1], [0, 1]);
  return (
    <section
      id="bangladesh"
      className="pulse-bangladesh"
      ref={target}
      aria-labelledby="bangladesh-title"
      data-motion={enabled}
    >
      <div className="shell bangladesh-layout">
        <div className="bangladesh-copy">
          <p className="pulse-kicker">{t.mapLabel}</p>
          <h2 id="bangladesh-title">
            {t.mapTitle}
            <span>{t.mapAccent}</span>
          </h2>
          <p>{t.mapBody}</p>
          <div className="map-honesty">
            <span className="signal-dot" />
            {t.mapNote}
          </div>
        </div>
        <figure className="country-figure">
          <m.svg
            viewBox={MAP_VIEWBOX}
            role="img"
            aria-label={t.mapAlt}
            className="country-map"
            style={enabled ? { scale } : {}}
          >
            <defs>
              <radialGradient id="country-fill">
                <stop offset="0" stopColor="var(--map-fill-bright)" />
                <stop offset="1" stopColor="var(--map-fill)" />
              </radialGradient>
            </defs>
            <path d={MAP_OUTLINE} fill="url(#country-fill)" className="country-base" />
            {MAP_DIVISIONS.map((division) => (
              <path key={division.key} d={division.d} className="country-division" />
            ))}
            <m.path
              d={MAP_OUTLINE}
              className="country-outline"
              style={enabled ? { pathLength: trace } : {}}
            />
            <m.g className="country-connections" style={enabled ? { opacity: connections } : {}}>
              <path d="M268 220Q600 270 508 664Q360 835 324 886 M131 537Q350 380 508 664Q680 640 814 415 M508 664Q810 710 796 999 M508 664Q400 820 495 919" />
              <circle cx="508" cy="664" r="12" />
              <circle cx="508" cy="664" r="27" className="country-halo" />
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
        <div className="closing-signal" aria-hidden="true">
          <span />
        </div>
      </div>
    </section>
  );
}
