/**
 * `<BrandLogo>`: the official MedLiveBD logo (FRONTEND.md §0.5).
 *
 * The owner made the logo official on 2026-10-07 with one rule above the
 * others: its artwork, proportions and colours are never redrawn, simplified
 * or recoloured. So this component draws nothing. It shows the supplied light
 * lockup, at the height asked for and at its own proportions, and that is all.
 *
 * ## Why it multiplies onto the ground
 *
 * The supplied artwork is the logo on a white ground, not on transparency. On
 * the app's near-white ground a white box would show; `mix-blend-mode:
 * multiply` lets the ground through the white without touching a colour of the
 * mark. A transparent master from the designer would make the line
 * unnecessary, and replacing `LOGO_SRC` is the whole change.
 *
 * ## Its words
 *
 * The image is decorative to a screen reader (`alt=""`): the product's name is
 * said once, in text, by the visually hidden span beside it, so the heading it
 * sits in reads "MedLiveBD" and `data-testid="app-name"` still holds the name.
 */

import { tp } from '@platform/i18n';
import { useLocale } from '@platform/ui';

import type { ReactNode } from 'react';

/** The light lockup, cut from the supplied artwork (`docs/design/brand`). */
const LOGO_SRC = '/brand/medlivebd-logo-light.webp';

/** The lockup's own proportions: 727 × 480 at the master's native pixels. */
const ASPECT = 727 / 480;

export function BrandLogo({ height }: { readonly height: number }): ReactNode {
  const locale = useLocale();
  return (
    <span className="inline-flex shrink-0 items-center">
      <img
        src={LOGO_SRC}
        alt=""
        width={Math.round(height * ASPECT)}
        height={height}
        decoding="async"
        // The header's logo is the first thing on the first screen.
        fetchPriority="high"
        className="block mix-blend-multiply"
        style={{ height, width: Math.round(height * ASPECT) }}
      />
      <span className="sr-only">{tp('appName', locale)}</span>
    </span>
  );
}
