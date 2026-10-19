'use client';

import { m, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';

import { copy } from '@/content/copy';

import { useMotionWelcome } from '../scroll';

function Word({ word, index, count, progress, enabled }) {
  const start = (index / count) * 0.5;
  const opacity = useTransform(progress, [start, start + 0.12], [0.16, 1]);
  return (
    <m.span className="idea-word" data-scrub="" style={enabled ? { opacity } : {}}>
      {word}{' '}
    </m.span>
  );
}

/**
 * The page's signature moment (S-C-01): the one idea, lit word by word as the
 * reader arrives, then the connection it names — hospitals on one side,
 * patients on the other, MedLiveBD between. A signal leaves the hospital,
 * passes through MedLiveBD and reaches the patient: the live queue, told
 * without a screenshot. Tied to scroll and reversible; still and complete
 * without script or with reduced motion.
 */
export function Idea({ locale }) {
  const t = copy[locale].idea;
  const target = useRef(null);
  const enabled = useMotionWelcome();
  const { scrollYProgress: p } = useScroll({ target, offset: ['start 0.8', 'end 0.6'] });
  const left = useTransform(p, [0.42, 0.7], [0, 1]);
  const right = useTransform(p, [0.62, 0.9], [0, 1]);
  const hub = useTransform(p, [0.6, 0.7], [0.7, 1]);
  const signal = useTransform(p, [0.5, 0.95], ['0%', '100%']);
  const signalOpacity = useTransform(p, [0.48, 0.54, 0.9, 0.98], [0, 1, 1, 0]);
  const words = t.statement.split(' ');
  return (
    <section id="idea" className="idea" ref={target} aria-labelledby="idea-title">
      <div className="shell idea-inner">
        <p className="eyebrow">{t.label}</p>
        <h2 id="idea-title" className="display-l idea-statement">
          <span className="sr-only">{t.statement}</span>
          <span aria-hidden="true">
            {words.map((word, index) => (
              <Word
                key={`${word}-${String(index)}`}
                word={word}
                index={index}
                count={words.length}
                progress={p}
                enabled={enabled}
              />
            ))}
          </span>
        </h2>
        <p className="idea-body">{t.body}</p>
        <div
          className="motif"
          role="img"
          aria-label={`${t.hospitals} — MedLiveBD — ${t.patients}`}
          data-motion={enabled}
        >
          <div className="motif-end motif-start">
            <strong>{t.hospitals}</strong>
            <span>{t.hospitalsParts}</span>
          </div>
          <div className="motif-track">
            <span className="motif-rail motif-rail-left">
              <m.span className="motif-ink" data-scrub="" style={enabled ? { scaleX: left } : {}} />
            </span>
            <m.span className="motif-hub" data-scrub="" style={enabled ? { scale: hub } : {}}>
              <img src="/brand/medlivebd-mark.webp" alt="" width="222" height="128" />
            </m.span>
            <span className="motif-rail motif-rail-right">
              <m.span
                className="motif-ink"
                data-scrub=""
                style={enabled ? { scaleX: right } : {}}
              />
            </span>
            {/* A full-width runner carries the signal, so it moves by transform alone. */}
            {enabled ? (
              <m.span className="motif-runner" style={{ x: signal, opacity: signalOpacity }}>
                <span className="motif-signal" />
              </m.span>
            ) : null}
          </div>
          <div className="motif-end motif-finish">
            <strong>{t.patients}</strong>
            <span>{t.patientsParts}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
