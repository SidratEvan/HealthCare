'use client';

import { AnimatePresence, m } from 'framer-motion';
import { useRef, useState } from 'react';

import { copy } from '@/content/copy';

import { ordinal, fmt } from '../format';
import { Icon } from '../icons';
import { EASE, Reveal, useAutoplay } from '../motion';

import type { IconName } from '../icons';
import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

const INTERVAL = 5200;

type NodeKey = 'reception' | 'core' | 'phones' | 'doctor' | 'admin';
const NODES: readonly { key: NodeKey; x: number; y: number; icon: IconName }[] = [
  { key: 'reception', x: 14, y: 50, icon: 'desk' },
  { key: 'core', x: 50, y: 50, icon: 'pulse' },
  { key: 'phones', x: 86, y: 17, icon: 'phone' },
  { key: 'doctor', x: 86, y: 50, icon: 'doctor' },
  { key: 'admin', x: 86, y: 83, icon: 'chart' },
];
const at = (key: NodeKey): { x: number; y: number } => {
  const node = NODES.find((entry) => entry.key === key);
  return { x: node?.x ?? 50, y: node?.y ?? 50 };
};
const EDGES: readonly [NodeKey, NodeKey][] = [
  ['reception', 'core'],
  ['core', 'phones'],
  ['core', 'doctor'],
  ['core', 'admin'],
];
/** Which edges carry a signal, and which nodes light, at each step. */
const ACTIVE_EDGES: readonly (readonly number[])[] = [[0], [], [1, 2, 3], []];
const ACTIVE_NODES: readonly (readonly NodeKey[])[] = [
  ['reception', 'core'],
  ['core'],
  ['core', 'phones', 'doctor', 'admin'],
  [],
];
/** At the last step the connection is down: these nodes say so, in the warning colour. */
const WARN_NODES: readonly NodeKey[] = ['reception', 'phones'];

function Diagram({ locale, step }: { readonly locale: Locale; readonly step: number }): ReactNode {
  const t = copy[locale];
  const n = t.howNodes;
  return (
    <div className="hw-diagram" aria-hidden="true">
      <svg className="hw-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
        {EDGES.map(([from, to], index) => {
          const a = at(from);
          const b = at(to);
          const on = ACTIVE_EDGES[step]?.includes(index) ?? false;
          return (
            <line
              key={`${from}-${to}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={on ? 'is-on' : undefined}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      {EDGES.map(([from, to], index) => {
        if (!(ACTIVE_EDGES[step]?.includes(index) ?? false)) return null;
        const a = at(from);
        const b = at(to);
        return (
          <m.i
            key={`${String(step)}-${from}-${to}`}
            className="hw-pulse"
            initial={{ left: `${String(a.x)}%`, top: `${String(a.y)}%`, opacity: 0 }}
            animate={{
              left: [`${String(a.x)}%`, `${String(b.x)}%`],
              top: [`${String(a.y)}%`, `${String(b.y)}%`],
              opacity: [0, 1, 1, 0],
            }}
            transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 0.4, ease: 'easeInOut' }}
          />
        );
      })}
      {NODES.map((node) => {
        const on = ACTIVE_NODES[step]?.includes(node.key) ?? false;
        const warn = step === 3 && WARN_NODES.includes(node.key);
        return (
          <div
            key={node.key}
            className={`hw-node hw-${node.key}${on ? ' is-on' : ''}${warn ? ' is-warn' : ''}`}
            style={{ left: `${String(node.x)}%`, top: `${String(node.y)}%` }}
          >
            <span className="hw-icon">
              <Icon name={node.icon} />
            </span>
            <span className="hw-name">{n[node.key]}</span>
            <AnimatePresence>
              {node.key === 'reception' && step === 0 ? (
                <m.span
                  key="tap"
                  className="hw-badge"
                  initial={{ opacity: 0, y: 6, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4, ease: EASE }}
                >
                  {t.live.callNext}
                </m.span>
              ) : null}
              {node.key === 'reception' && step === 3 ? (
                <m.span
                  key="offline"
                  className="hw-badge hw-badge-sync"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <span className="sync-off">
                    <Icon name="wifiOff" />
                    {n.offline}
                  </span>
                  <span className="sync-on">
                    <Icon name="check" />
                    {n.synced}
                  </span>
                </m.span>
              ) : null}
              {node.key === 'phones' && step === 2 ? (
                <m.span
                  key="serving"
                  className="hw-badge hw-badge-live"
                  initial={{ opacity: 0, y: 6, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4, delay: 0.7, ease: EASE }}
                >
                  {t.live.nowServing} <b>{fmt(7, locale)}</b>
                </m.span>
              ) : null}
              {node.key === 'phones' && step === 3 ? (
                <m.span
                  key="age"
                  className="hw-badge hw-badge-age"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4, delay: 0.3 }}
                >
                  <Icon name="clock" />
                  {n.age}
                </m.span>
              ) : null}
            </AnimatePresence>
          </div>
        );
      })}
      <AnimatePresence>
        {step === 1 ? (
          <m.ol
            key="log"
            className="hw-log"
            initial="hidden"
            animate="show"
            exit={{ opacity: 0 }}
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.35 } } }}
          >
            {[...n.log].reverse().map((entry, index) => (
              <m.li
                key={entry}
                variants={{
                  hidden: { opacity: 0, y: -8 },
                  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
                }}
                className={index === n.log.length - 1 ? 'is-new' : undefined}
              >
                <i />
                {entry}
              </m.li>
            ))}
          </m.ol>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** One event, every screen that needs it (S-C-02): the live queue, step by step. */
export function HowItWorks({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  const [step, setStep] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const auto = useAutoplay(root, INTERVAL, () => {
    setStep((value) => (value + 1) % t.howSteps.length);
  });
  return (
    <section className="how dark-band section-space" id="how" aria-labelledby="how-heading">
      <div className="how-glow" aria-hidden="true" />
      <div className="shell">
        <Reveal className="section-head section-head-wide">
          <p className="eyebrow">{t.howLabel}</p>
          <h2 id="how-heading">{t.howTitle}</h2>
          <p className="body-large">{t.howBody}</p>
        </Reveal>
        <Reveal className="how-layout" delay={0.1}>
          <div ref={root} className="how-steps-wrap">
            <ol className="how-steps">
              {t.howSteps.map((entry, index) => {
                const current = index === step;
                return (
                  <li key={entry.title} className={current ? 'is-current' : undefined}>
                    <button
                      type="button"
                      aria-current={current ? 'step' : undefined}
                      onClick={() => {
                        setStep(index);
                        auto.restart();
                      }}
                    >
                      <span className="how-num" aria-hidden="true">
                        {ordinal(index + 1, locale)}
                      </span>
                      <span className="how-text">
                        <strong>{entry.title}</strong>
                        <span className="how-body">{entry.body}</span>
                      </span>
                      {current && auto.playing ? (
                        <m.i
                          key={`progress-${String(step)}`}
                          className="how-progress"
                          aria-hidden="true"
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={{ duration: INTERVAL / 1000, ease: 'linear' }}
                        />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>
            {auto.reduced ? null : (
              <button
                type="button"
                className="stage-toggle stage-toggle-dark"
                onClick={auto.toggle}
                aria-label={auto.playing ? t.howPause : t.howPlay}
              >
                <Icon name={auto.playing ? 'pause' : 'play'} />
              </button>
            )}
          </div>
          <Diagram locale={locale} step={step} />
        </Reveal>
      </div>
    </section>
  );
}
