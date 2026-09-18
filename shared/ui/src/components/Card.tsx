/**
 * Card (FRONTEND.md §5.4).
 *
 * "Surface + `radius-md` + hairline border + 16 px padding. Content order:
 * title → meta → live data chips → action. Never more than one action per
 * card. No left accent strip."
 *
 * The last sentence is one of the banned patterns (§0.2:
 * `border-l-4 border-indigo-500`), which is why this component takes no
 * `accent` prop — there is no way to ask it for one.
 *
 * Depth is surface plus a hairline, not shadow (§3.3). `elevated` lifts to
 * `elev-1` and is for a row that is genuinely raised — a hovered console row
 * — not for making a card look important.
 */

import { cx } from './cx.js';

import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className'> {
  readonly children: ReactNode;
  readonly elevated?: boolean;
  /** Brand-tinted surface, for the card carrying the live figure. */
  readonly tone?: 'default' | 'brand' | 'warn' | 'alert';
  /** `radius-lg` and more padding, for a hero card (§3.2). */
  readonly hero?: boolean;
}

const TONE = {
  default: 'bg-surface border-line',
  brand: 'bg-brand-100 border-brand-border',
  warn: 'bg-warn-100 border-warn-border',
  alert: 'bg-alert-100 border-alert-600',
} as const;

export function Card({
  children,
  elevated = false,
  tone = 'default',
  hero = false,
  ...rest
}: CardProps): ReactNode {
  return (
    <div
      {...rest}
      className={cx(
        'border',
        hero ? 'rounded-lg p-6' : 'rounded-md p-4',
        TONE[tone],
        elevated && 'shadow-1',
      )}
    >
      {children}
    </div>
  );
}

/** The card's title. Separate so the content order in §5.4 is expressible. */
export function CardTitle({ children }: { readonly children: ReactNode }): ReactNode {
  return <h3 className="font-ui text-title-sm text-ink">{children}</h3>;
}

/** Supporting line under the title — doctor, hospital, time. */
export function CardMeta({ children }: { readonly children: ReactNode }): ReactNode {
  return <p className="font-ui text-body-sm text-ink-muted">{children}</p>;
}
