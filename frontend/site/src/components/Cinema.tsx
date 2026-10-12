'use client';

import { m, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';

import { EASE } from './motion';

import type { ReactNode } from 'react';

/**
 * Cinematic motion for photographs and line art: a slow parallax drift, a
 * reveal that opens like a curtain, and an ECG trace that draws itself as the
 * reader scrolls. Transform and opacity only; nothing moves under reduced
 * motion.
 */

/** Drifts its child against the scroll and settles a slight zoom as it enters. */
export function Parallax({
  children,
  className,
  distance = 60,
  zoom = 0.08,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  /** How far, in pixels, the content travels across the viewport. */
  readonly distance?: number;
  /** Extra scale at the start, easing to 1 at the centre. */
  readonly zoom?: number;
}): ReactNode {
  const frame = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion() ?? false;
  const { scrollYProgress } = useScroll({ target: frame, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [-distance, distance]);
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], [1 + zoom, 1.02, 1.02 + zoom / 2]);
  return (
    <div ref={frame} className={className}>
      <m.div className="parallax-inner" style={reduced ? {} : { y, scale }}>
        {children}
      </m.div>
    </div>
  );
}

/** Opens from the bottom edge like a lifting curtain, once, when reached. */
export function CurtainReveal({
  children,
  className,
  delay = 0,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly delay?: number;
}): ReactNode {
  return (
    <m.div
      className={className}
      data-reveal=""
      initial={{ clipPath: 'inset(18% 0% 0% 0% round 28px)', opacity: 0 }}
      whileInView={{ clipPath: 'inset(0% 0% 0% 0% round 28px)', opacity: 1 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 1.3, delay, ease: EASE }}
    >
      {children}
    </m.div>
  );
}

/** One heartbeat across a 1200-unit line: flat, a P wave, the QRS spike, a T wave, flat. */
function beat(x: number, h: number): string {
  return [
    `L${String(x + 40)} 0`,
    `C${String(x + 52)} 0 ${String(x + 56)} ${String(-h * 0.14)} ${String(x + 64)} ${String(-h * 0.14)}`,
    `C${String(x + 72)} ${String(-h * 0.14)} ${String(x + 76)} 0 ${String(x + 86)} 0`,
    `L${String(x + 100)} 0 L${String(x + 108)} ${String(h * 0.18)} L${String(x + 120)} ${String(-h)} L${String(x + 132)} ${String(h * 0.42)} L${String(x + 140)} 0`,
    `L${String(x + 160)} 0`,
    `C${String(x + 176)} 0 ${String(x + 182)} ${String(-h * 0.26)} ${String(x + 196)} ${String(-h * 0.26)}`,
    `C${String(x + 210)} ${String(-h * 0.26)} ${String(x + 216)} 0 ${String(x + 232)} 0`,
  ].join(' ');
}

export function ecgPath(width: number, beats: number, height: number): string {
  const gap = width / beats;
  let d = 'M0 0';
  for (let i = 0; i < beats; i += 1)
    d += ` ${beat(i * gap + (gap - 232) / 2, height)} L${String((i + 1) * gap)} 0`;
  return d;
}

/**
 * An ECG trace drawn by scrolling: the line writes itself as the section
 * moves through the viewport, with a bright head where the pen is.
 */
export function ScrollEcg({
  className,
  beats = 4,
}: {
  readonly className?: string;
  readonly beats?: number;
}): ReactNode {
  const frame = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion() ?? false;
  const { scrollYProgress } = useScroll({ target: frame, offset: ['start 90%', 'end 35%'] });
  const length = useTransform(scrollYProgress, [0, 1], [0.02, 1]);
  const d = ecgPath(1200, beats, 46);
  return (
    <div ref={frame} className={className} aria-hidden="true">
      <svg viewBox="0 -60 1200 110" preserveAspectRatio="none">
        <path d={d} className="ecg-ghost" vectorEffect="non-scaling-stroke" />
        <m.path
          d={d}
          className="ecg-line"
          vectorEffect="non-scaling-stroke"
          style={reduced ? {} : { pathLength: length }}
        />
      </svg>
    </div>
  );
}

/** A heartbeat that runs on its own between two points — the hero's connection. */
export function PulseEcg({
  className,
  playing = true,
}: {
  readonly className?: string;
  /** False when the visitor paused the illustration (WCAG 2.2.2). */
  readonly playing?: boolean;
}): ReactNode {
  const prefersReduced = useReducedMotion() ?? false;
  const reduced = !playing || prefersReduced;
  const d = ecgPath(600, 2, 38);
  return (
    <svg className={className} viewBox="0 -50 600 90" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} className="ecg-ghost" vectorEffect="non-scaling-stroke" />
      <m.path
        d={d}
        className="ecg-line"
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0, pathOffset: 0 }}
        animate={
          reduced
            ? { pathLength: 1, pathOffset: 0 }
            : { pathLength: [0, 0.45, 0.45], pathOffset: [0, 0.55, 1] }
        }
        transition={
          reduced ? { duration: 0 } : { duration: 3.2, repeat: Infinity, ease: 'easeInOut' }
        }
      />
    </svg>
  );
}

/**
 * A stethoscope in fine line art — earpieces, binaural tubes, the long tubing
 * and a chest piece with its diaphragm rings — drawn stroke by stroke when
 * reached.
 */
export function Stethoscope({ className }: { readonly className?: string }): ReactNode {
  const strokes = [
    // ear tips and binaurals
    'M58 18 C52 18 48 24 50 30 L62 92 C66 112 80 124 100 126',
    'M142 18 C148 18 152 24 150 30 L138 92 C134 112 120 124 100 126',
    // tubing down and round to the chest piece
    'M100 126 C100 170 96 214 72 236 C44 262 40 306 70 330 C102 356 150 340 160 300 C166 276 166 258 166 246',
    // chest piece: bell, diaphragm and rim
    'M166 246 m-30 0 a30 30 0 1 0 60 0 a30 30 0 1 0 -60 0',
    'M166 246 m-19 0 a19 19 0 1 0 38 0 a19 19 0 1 0 -38 0',
    'M166 246 m-8 0 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0',
  ];
  return (
    <svg className={className} viewBox="0 0 220 360" aria-hidden="true">
      <circle cx="58" cy="16" r="6" className="instrument-dot" />
      <circle cx="142" cy="16" r="6" className="instrument-dot" />
      {strokes.map((d, index) => (
        <m.path
          key={d}
          d={d}
          className="instrument-line"
          initial={{ pathLength: 0, opacity: 0 }}
          whileInView={{ pathLength: 1, opacity: 1 }}
          viewport={{ once: true, margin: '0px 0px -15% 0px' }}
          transition={{ duration: 1.6, delay: index * 0.18, ease: EASE }}
        />
      ))}
    </svg>
  );
}
