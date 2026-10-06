'use client';

/**
 * A hospital's own logo where it has set one, and the plain hospital mark
 * where it has not (`FR-BRD-06`).
 *
 * Most hospitals have none, and a card has to look right with none: the
 * fallback is the icon every card carried before, not an empty box. A logo
 * that fails to load (the address is public, the network is not always
 * there) falls back to the same icon, so a card never shows a broken image.
 *
 * Decorative: the hospital's name is always beside it, so it has no text of
 * its own for a screen reader to say twice.
 */

import { useState, type ReactNode } from 'react';

import { HospitalIcon } from '@/components/icons';
import { logoUrl } from '@/lib/api';

export function HospitalMark({
  hospitalId,
  logoVersion,
  size = 'card',
}: {
  readonly hospitalId: string;
  readonly logoVersion: string | null | undefined;
  /** `card`: beside a name in a list. `header`: beside a page's title. */
  readonly size?: 'card' | 'header';
}): ReactNode {
  const [failed, setFailed] = useState(false);

  if (logoVersion == null || failed) {
    return (
      <span className="mt-0.5 text-brand-600" data-testid="facility-mark" data-logo="false">
        <HospitalIcon size={size === 'header' ? 28 : 22} />
      </span>
    );
  }

  const pixels = size === 'header' ? 44 : 40;
  return (
    <img
      src={logoUrl(hospitalId, logoVersion)}
      alt=""
      width={pixels}
      height={pixels}
      loading="lazy"
      decoding="async"
      data-testid="facility-mark"
      data-logo="true"
      className={
        size === 'header'
          ? 'size-11 shrink-0 rounded-sm object-contain'
          : 'size-10 shrink-0 rounded-sm object-contain'
      }
      onError={() => {
        setFailed(true);
      }}
    />
  );
}
