'use client';

import { AnimatePresence, m, useScroll, useTransform } from 'framer-motion';
import { useRef, useState } from 'react';

import { copy } from '@/content/copy';

import { BrowserFrame, PhoneFrame, screen } from '../frames';
import { Icon } from '../icons';
import { EASE, Reveal } from '../motion';

import type { Locale } from '@/content/copy';
import type { KeyboardEvent, ReactNode } from 'react';

/** The six workspaces, as their real screens (S-C-02). */
export function Showcase({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const frame = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: frame, offset: ['start end', 'center center'] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [14, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.92, 1]);
  const feature = t.features[selected] ?? t.features[0];
  if (feature === undefined) return null;

  const choose = (index: number): void => {
    const count = t.features.length;
    const next = (index + count) % count;
    setSelected(next);
    tabs.current[next]?.focus();
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowRight') choose(selected + 1);
    else if (event.key === 'ArrowLeft') choose(selected - 1);
    else if (event.key === 'Home') choose(0);
    else if (event.key === 'End') choose(t.features.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <section className="showcase section-space" id="product" aria-labelledby="product-heading">
      <div className="shell">
        <Reveal className="section-head section-head-center">
          <p className="eyebrow">{t.productLabel}</p>
          <h2 id="product-heading">{t.productTitle}</h2>
          <p className="body-large">{t.productBody}</p>
        </Reveal>
        <Reveal className="tabs-wrap" delay={0.05}>
          <div className="tabs" role="tablist" aria-label={t.featureLabel} onKeyDown={onKey}>
            {t.features.map((item, index) => {
              const current = index === selected;
              return (
                <button
                  key={item.key}
                  ref={(element) => {
                    tabs.current[index] = element;
                  }}
                  id={`tab-${item.key}`}
                  type="button"
                  role="tab"
                  aria-selected={current}
                  aria-controls="workflow-view"
                  tabIndex={current ? 0 : -1}
                  onClick={() => {
                    setSelected(index);
                  }}
                >
                  {current ? (
                    <m.span
                      layoutId="tab-indicator"
                      className="tab-indicator"
                      transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                    />
                  ) : null}
                  <span className="tab-label">{item.label}</span>
                </button>
              );
            })}
          </div>
        </Reveal>
        <div
          id="workflow-view"
          className="showcase-stage"
          role="tabpanel"
          aria-labelledby={`tab-${feature.key}`}
        >
          <div className="showcase-text" aria-live="polite" aria-atomic="true">
            <AnimatePresence mode="wait" initial={false}>
              <m.div
                key={feature.key}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.4, ease: EASE }}
              >
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
                <ul className="showcase-points">
                  {feature.points.map((point) => (
                    <li key={point}>
                      <Icon name="check" />
                      {point}
                    </li>
                  ))}
                </ul>
                <p className="showcase-detail">
                  <span className="live-dot" aria-hidden="true" />
                  {feature.detail}
                </p>
              </m.div>
            </AnimatePresence>
          </div>
          <div className="showcase-frame" ref={frame}>
            <m.div className="showcase-tilt" style={{ rotateX, scale }}>
              <AnimatePresence mode="popLayout" initial={false}>
                <m.div
                  key={feature.key}
                  className={`showcase-screen screen-${feature.key}`}
                  initial={{ opacity: 0, y: 24, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -16, scale: 0.98 }}
                  transition={{ duration: 0.55, ease: EASE }}
                >
                  {feature.key === 'patient' ? (
                    <PhoneFrame src={screen(feature.key, locale)} alt={feature.alt} />
                  ) : (
                    <BrowserFrame
                      src={screen(feature.key, locale)}
                      alt={feature.alt}
                      label={feature.label}
                    />
                  )}
                </m.div>
              </AnimatePresence>
            </m.div>
            <p className="frame-caption">{t.illustrative}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
