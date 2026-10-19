'use client';

import { LazyMotion, MotionConfig, m, useInView, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

const loadFeatures = async () => (await import('./motion-features')).default;

/** The site's one easing: quick to start, long soft landing. */
export const EASE = [0.22, 1, 0.36, 1];

/**
 * Motion for the whole page. `reducedMotion="user"` drops movement (not fades)
 * for visitors who ask for less; loops check `useReducedMotion` themselves.
 */
export function MotionProvider({ children }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user" transition={{ ease: EASE, duration: 0.7 }}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}

const VIEWPORT = { once: true, margin: '0px 0px -12% 0px' };

/**
 * Rises into place once, when reached. Server HTML starts hidden; the layout's
 * <noscript> style shows `[data-reveal]` for a visitor without script.
 */
export function Reveal({ children, className, delay = 0, y = 28 }) {
  return (
    <m.div
      className={className}
      data-reveal=""
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: 0.9, delay, ease: EASE }}
    >
      {children}
    </m.div>
  );
}

const list = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };
export const item = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } },
};

/** A list whose items rise in sequence. Items are `<m.li variants={item}>`. */
export function RevealList({ children, className, ordered = false, label }) {
  const Tag = ordered ? m.ol : m.ul;
  return (
    <Tag
      className={className}
      data-reveal=""
      variants={list}
      initial="hidden"
      whileInView="show"
      viewport={VIEWPORT}
      {...(label === undefined ? {} : { tabIndex: 0, 'aria-label': label })}
    >
      {children}
    </Tag>
  );
}

export function RevealItem({ children, className }) {
  return (
    <m.li className={className} variants={item}>
      {children}
    </m.li>
  );
}

/**
 * Advances a looping illustration every `interval` ms — only while it is on
 * screen, the tab is visible, the visitor has not paused it, and motion is
 * welcome. Returns the controls a visible pause button needs (WCAG 2.2.2).
 */
export function useAutoplay(target, interval, step) {
  const reduced = useReducedMotion() ?? false;
  const inView = useInView(target, { amount: 0.35 });
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });

  useEffect(() => {
    const onVisibility = () => {
      setVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const playing = !paused && !reduced;
  useEffect(() => {
    if (!playing || !inView || !visible) return;
    const id = window.setInterval(() => {
      stepRef.current();
    }, interval);
    return () => {
      window.clearInterval(id);
    };
  }, [playing, inView, visible, interval, epoch]);

  return {
    playing,
    reduced,
    toggle: () => {
      setPaused((value) => !value);
    },
    restart: () => {
      setEpoch((value) => value + 1);
    },
  };
}
