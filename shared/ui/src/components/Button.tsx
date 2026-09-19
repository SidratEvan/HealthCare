/**
 * Button (FRONTEND.md §5.1).
 *
 * ## The rules this encodes, rather than documents
 *
 * **Emergency is not a variant you reach for.** `emergency` fills with
 * `--alert-*`, which §1.1's colour law reserves for emergency and genuine
 * danger — "a 'cancel booking' button is neutral, not red. If red loses its
 * meaning, the emergency button loses its power." A destructive confirmation
 * inside a modal uses `danger-quiet` instead.
 *
 * **Loading preserves the width.** The spinner replaces the label in place, so
 * the layout never jumps under a thumb that is already moving toward the next
 * control. A button that resizes while being pressed is how a receptionist
 * marks the wrong patient.
 *
 * **Disabled says why.** §5.1: "Never disable a primary silently — always say
 * what's missing." `disabledReason` is required whenever `disabled` is set, so
 * the API makes the silent version impossible to write.
 */

import { forwardRef } from 'react';

import { cx } from './cx.js';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'emergency' | 'danger-quiet';

/** §5.1 sizes. Every one clears the 44px touch floor (`FR-LOC-04`). */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white border border-brand-600 hover:bg-brand-700',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-sunken',
  quiet: 'bg-transparent text-brand-600 border border-transparent hover:bg-brand-100',
  emergency: 'bg-alert-600 text-white border border-alert-600 hover:bg-alert-700',
  'danger-quiet': 'bg-surface text-alert-600 border border-line-strong hover:bg-alert-100',
};

/**
 * Heights from §5.1. `sm` is 40px and is console-only — it sits in a table row
 * where the pointer is a mouse, which is why it is the one size below the
 * touch floor and why the type below names that restriction.
 */
const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-[40px] px-3 text-body-sm rounded-sm',
  md: 'min-h-touch px-4 text-body-md rounded-md',
  lg: 'min-h-[56px] px-5 text-body-lg rounded-md',
  xl: 'min-h-[60px] px-6 text-title-md rounded-lg',
};

type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'disabled'>;

interface ButtonBase extends NativeButtonProps {
  readonly children: ReactNode;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Replaces the label with a spinner without changing the width. */
  readonly loading?: boolean;
  readonly fullWidth?: boolean;
}

/**
 * Disabling requires a reason (§5.1).
 *
 * A discriminated union rather than an optional field, so
 * `<Button disabled>` does not compile. The reason becomes the accessible
 * description, which is what a screen-reader user gets instead of a tooltip.
 */
export type ButtonProps = ButtonBase &
  (
    | { readonly disabled: true; readonly disabledReason: string }
    | { readonly disabled?: false; readonly disabledReason?: never }
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    variant = 'primary',
    size = 'md',
    loading = false,
    fullWidth = false,
    disabled = false,
    disabledReason,
    type = 'button',
    ...rest
  },
  ref,
) {
  // A loading button is not disabled: a disabled control leaves the tab order
  // and the focus a user had just placed on it is lost. `aria-busy` plus
  // ignoring the click keeps it focusable and announced.
  const inert = disabled || loading;

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={inert || undefined}
      title={disabled ? disabledReason : rest.title}
      className={cx(
        'relative inline-flex items-center justify-center gap-2 font-ui font-semibold',
        'transition-colors duration-instant ease-standard',
        // §5.1: 2px ring, 2px offset. Focus-visible only, so a mouse click
        // does not leave a ring behind but a keyboard user always sees one.
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
        // §5.1 active: scale 0.985. No bounce, no spring (§3.4).
        !inert && 'active:scale-[0.985]',
        disabled && 'opacity-40 cursor-not-allowed',
        VARIANT[variant],
        SIZE[size],
        fullWidth && 'w-full',
      )}
    >
      {/*
        The label stays in the flow while loading and is only made invisible,
        so the button keeps the exact width it had. Removing it would let the
        button shrink to the spinner under a thumb already in motion.
      */}
      <span className={cx('inline-flex items-center gap-2', loading && 'invisible')}>
        {children}
      </span>

      {loading ? (
        <span className="absolute inset-0 inline-flex items-center justify-center">
          <Spinner />
        </span>
      ) : null}
    </button>
  );
});

/**
 * The inline spinner.
 *
 * Drawn as SVG so it inherits `currentColor` (`ICO-02`) and needs no icon
 * font. `aria-hidden` because `aria-busy` on the button already carries the
 * state — announcing both says "loading" twice.
 */
function Spinner(): ReactNode {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="motion-safe:animate-spin"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}
