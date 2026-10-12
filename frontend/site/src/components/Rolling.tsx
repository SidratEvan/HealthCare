'use client';

import { AnimatePresence, m } from 'framer-motion';

import { fmt } from './format';
import { EASE } from './motion';

import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

/** A figure that rolls to its new value, the way a live counter should. */
export function Rolling({
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
