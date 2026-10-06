'use client';

/**
 * A figure a hospital has and does not share (`FR-NET-04`, `PRD.md` §3.2).
 *
 * A hospital decides which live figures it gives the network. One it keeps is
 * said to be not shared, in words, in the place the figure would have been:
 * never a zero, never "none", and never an empty space a patient reads as
 * either. Neutral, because it is neither good news nor bad.
 */

import { tp } from '@platform/i18n';
import { Chip, useLocale } from '@platform/ui';

import type { ReactNode } from 'react';

const KEY = { serials: 'serialsNotShared', beds: 'bedsNotShared' } as const;

export function NotShared({ figure }: { readonly figure: keyof typeof KEY }): ReactNode {
  const locale = useLocale();
  return (
    <span data-testid={`${figure}-not-shared`}>
      <Chip tone="neutral">{tp(KEY[figure], locale)}</Chip>
    </span>
  );
}

/** Whether a listing withholds a figure it has. */
export function withholds(
  listing: { readonly notShared?: readonly string[] },
  figure: keyof typeof KEY,
): boolean {
  return listing.notShared?.includes(figure) === true;
}
