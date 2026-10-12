'use client';

import {
  AnimatePresence,
  m,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion';
import { useRef, useState } from 'react';

import { copy } from '@/content/copy';

import { fmt } from './format';
import { Icon } from './icons';
import { EASE, useAutoplay } from './motion';

import type { Locale } from '@/content/copy';
import type { PointerEvent, ReactNode } from 'react';

/**
 * The product's one promise, drawn rather than described (S-C-01): reception
 * calls next, and the waiting patient's phone moves with it. A coded
 * illustration on demonstration data — the real screens follow further down.
 * The patient holds serial 9; the chamber walks 6 → 9, holds "your turn", and
 * starts again.
 */
const SEQUENCE = [6, 7, 8, 9, 9] as const;
const YOURS = 9;
const FIRST = SEQUENCE[0];
const INTERVAL = 2600;

/** A figure that rolls to its new value, the way a live counter should. */
function Rolling({
  value,
  locale,
}: {
  readonly value: number;
  readonly locale: Locale;
}): ReactNode {
  return (
    <span className="rolling">
      <AnimatePresence mode="popLayout" initial={false}>
        <m.span
          key={value}
          initial={{ y: '70%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '-70%', opacity: 0 }}
          transition={{ duration: 0.55, ease: EASE }}
        >
          {fmt(value, locale)}
        </m.span>
      </AnimatePresence>
    </span>
  );
}

function Console({
  locale,
  serving,
  onCall,
}: {
  readonly locale: Locale;
  readonly serving: number;
  readonly onCall: () => void;
}): ReactNode {
  const t = copy[locale].live;
  const waiting = 12 - (serving - FIRST);
  const queue = [1, 2, 3].map((offset) => serving + offset);
  const [lead, second, third] = t.doctors;
  return (
    <div className="dc">
      <div className="dc-bar" aria-hidden="true">
        <span className="dc-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="dc-host">{t.hospital}</span>
        <span className="dc-online">
          <span className="live-dot" />
          {t.online}
        </span>
      </div>
      <div className="dc-body">
        <div className="dc-rail" aria-hidden="true">
          <span className="is-on" />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="dc-main">
          <div className="dc-head" aria-hidden="true">
            <strong>{t.today}</strong>
            <span>{t.console}</span>
          </div>
          <div className="chamber is-active">
            <div className="chamber-who" aria-hidden="true">
              <strong>{lead?.name}</strong>
              <span>
                {lead?.dept} · {t.room}
              </span>
              <em className="chip chip-ok">
                <i />
                {t.started}
              </em>
            </div>
            <div className="chamber-now" aria-hidden="true">
              <span className="chamber-serial">
                <Rolling value={serving} locale={locale} />
              </span>
              <span className="chamber-label">
                {t.nowServing}
                <AnimatePresence mode="wait" initial={false}>
                  <m.b
                    key={serving}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    {t.patients[(serving - FIRST) % t.patients.length]}
                  </m.b>
                </AnimatePresence>
              </span>
            </div>
            <div className="chamber-count" aria-hidden="true">
              <Rolling value={waiting} locale={locale} />
              <span>{t.waiting}</span>
            </div>
            <m.button
              type="button"
              className="call-next"
              onClick={onCall}
              whileTap={{ scale: 0.94 }}
              aria-label={t.tryIt}
            >
              <span aria-hidden="true">{t.callNext}</span>
              <Icon name="arrow" className="arrow" />
              <AnimatePresence initial={false}>
                <m.span
                  key={serving}
                  className="call-ripple"
                  initial={{ opacity: 0.55, scale: 0.6 }}
                  animate={{ opacity: 0, scale: 1.9 }}
                  transition={{ duration: 0.9, ease: 'easeOut' }}
                  aria-hidden="true"
                />
              </AnimatePresence>
            </m.button>
            <ol className="chamber-queue" aria-hidden="true">
              {queue.map((serial, index) => (
                <li key={serial} className={serial === YOURS ? 'is-yours' : undefined}>
                  <b>{fmt(serial, locale)}</b>
                  <span>{t.patients[(serial - FIRST) % t.patients.length]}</span>
                  {index === 0 ? <em>{t.next}</em> : null}
                  {serial === YOURS ? <em className="via">{t.viaApp}</em> : null}
                </li>
              ))}
            </ol>
          </div>
          <div className="chamber chamber-quiet" aria-hidden="true">
            <div className="chamber-who">
              <strong>{second?.name}</strong>
              <span>{second?.dept}</span>
            </div>
            <span className="chamber-mini">
              <b>{fmt(3, locale)}</b>
              {t.nowServing}
            </span>
            <em className="chip chip-ok">
              <i />
              {t.started}
            </em>
          </div>
          <div className="chamber chamber-quiet" aria-hidden="true">
            <div className="chamber-who">
              <strong>{third?.name}</strong>
              <span>{third?.dept}</span>
            </div>
            <span className="chamber-mini">
              <b>—</b>
              {t.nowServing}
            </span>
            <em className="chip chip-wait">
              <i />
              {t.notArrived}
            </em>
          </div>
        </div>
      </div>
    </div>
  );
}

function Phone({
  locale,
  serving,
}: {
  readonly locale: Locale;
  readonly serving: number;
}): ReactNode {
  const t = copy[locale].live;
  const ahead = YOURS - serving;
  const turn = ahead === 0;
  const progress = (serving - FIRST + 1) / (YOURS - FIRST + 1);
  const lead = t.doctors[0];
  return (
    <div className="ph" aria-hidden="true">
      <div className="ph-screen">
        <div className="ph-status">
          <span>{locale === 'bn' ? '৯:৪১' : '9:41'}</span>
          <i className="ph-notch" />
          <span className="ph-signal">
            <i />
            <i />
            <i />
          </span>
        </div>
        <div className="ph-title">
          <span className="ph-back">‹</span>
          {t.phoneTitle}
        </div>
        <div className="ph-doctor">
          <span className="ph-avatar">{lead?.name.replace(/^(Dr |ডা\. )/, '').slice(0, 1)}</span>
          <span>
            <strong>{lead?.name}</strong>
            <small>{t.hospital}</small>
          </span>
        </div>
        <div className={`ph-card${turn ? ' is-turn' : ''}`}>
          <AnimatePresence initial={false}>
            <m.span
              key={serving}
              className="ph-flash"
              initial={{ opacity: 0.9 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
            />
          </AnimatePresence>
          <span className="ph-label">{t.yourSerial}</span>
          <span className="ph-serial">{fmt(YOURS, locale)}</span>
          <AnimatePresence mode="wait" initial={false}>
            {turn ? (
              <m.div
                key="turn"
                className="ph-turn"
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.45, ease: EASE }}
              >
                <Icon name="check" className="icon" />
                {t.yourTurn}
              </m.div>
            ) : (
              <m.div
                key="tiles"
                className="ph-tiles"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <span>
                  <small>{t.nowServing}</small>
                  <Rolling value={serving} locale={locale} />
                </span>
                <span>
                  <small>{t.ahead}</small>
                  <Rolling value={ahead} locale={locale} />
                </span>
              </m.div>
            )}
          </AnimatePresence>
          <span className="ph-bar">
            <m.i
              animate={{ scaleX: progress }}
              initial={false}
              transition={{ duration: 0.8, ease: EASE }}
            />
          </span>
          <span className="ph-fresh">
            <span className="live-dot" />
            {t.updated}
          </span>
        </div>
        <ol className="ph-steps">
          {t.steps.map((label, index) => {
            const reached = index === 0 || (index === 1 && !turn) || (index === 2 && turn);
            const done = index === 0 || (index === 1 && turn);
            return (
              <li
                key={label}
                className={`${done ? 'is-done' : ''} ${reached && !done ? 'is-now' : ''}`}
              >
                <i />
                <span>{label}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

export function LiveDemo({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale].live;
  const stage = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const serving = SEQUENCE[index] ?? FIRST;
  const auto = useAutoplay(stage, INTERVAL, () => {
    setIndex((value) => (value + 1) % SEQUENCE.length);
  });
  const call = (): void => {
    setIndex((value) => (SEQUENCE[value] === YOURS ? 0 : value + 1));
    auto.restart();
  };

  // A slight turn toward the pointer on large screens; none under reduced motion.
  const reduced = useReducedMotion() ?? false;
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-5, 5]), { stiffness: 90, damping: 18 });
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [4, -4]), { stiffness: 90, damping: 18 });
  const onMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (reduced || event.pointerType !== 'mouse') return;
    const box = event.currentTarget.getBoundingClientRect();
    px.set((event.clientX - box.left) / box.width - 0.5);
    py.set((event.clientY - box.top) / box.height - 0.5);
  };
  const onLeave = (): void => {
    px.set(0);
    py.set(0);
  };

  return (
    <figure className="stage" aria-describedby="live-description">
      <p id="live-description" className="sr-only">
        {t.description}
      </p>
      <div className="stage-scene" ref={stage} onPointerMove={onMove} onPointerLeave={onLeave}>
        <m.div className="stage-tilt" style={{ rotateX, rotateY }}>
          <m.div
            className="stage-console"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.1, delay: 0.15, ease: EASE }}
          >
            <Console locale={locale} serving={serving} onCall={call} />
          </m.div>
          <m.div
            className="stage-phone"
            initial={{ opacity: 0, y: 70 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, delay: 0.4, ease: EASE }}
          >
            <Phone locale={locale} serving={serving} />
          </m.div>
          <div className="stage-event" aria-hidden="true">
            <AnimatePresence initial={false}>
              {serving !== FIRST ? (
                <m.span
                  key={serving}
                  className="event-chip"
                  initial={{ opacity: 0, x: -36, scale: 0.92 }}
                  animate={{ opacity: [0, 1, 1, 0], x: [-36, 0, 18, 40], scale: 1 }}
                  transition={{ duration: 2.1, times: [0, 0.18, 0.75, 1], ease: 'easeOut' }}
                >
                  <span className="live-dot" />
                  {t.event} · <b>{fmt(serving, locale)}</b>
                  <small>{t.justNow}</small>
                </m.span>
              ) : null}
            </AnimatePresence>
          </div>
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
        <span>{t.caption}</span>
      </figcaption>
    </figure>
  );
}
