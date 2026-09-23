'use client';

/**
 * A button that can be off, and always says why (`FRONTEND.md` §5.1).
 *
 * `ButtonProps` is a discriminated union: `disabled` must be `true` with a
 * `disabledReason`, or absent. That is the right rule — a dead control with
 * no explanation is the thing §5.1 exists to prevent — but it makes
 * `disabled={busy || offline}` fail to compile, which is exactly when a
 * screen most wants a plain boolean.
 *
 * So this takes the reason instead of the boolean: a string turns the button
 * off *and* explains it, and `null` leaves it live. The reason becomes the
 * accessible description, so a screen-reader user hears it rather than
 * meeting a control that does nothing.
 *
 * `variant`, `size` and `testId` are required rather than optional. The
 * project runs `exactOptionalPropertyTypes`, so forwarding an absent prop
 * means forwarding `undefined`, which is not the same thing — and every
 * caller here has a real answer for all three anyway.
 */

import { Button, type ButtonSize, type ButtonVariant } from '@platform/ui';

import type { ReactNode } from 'react';

export function ActionButton({
  children,
  reason,
  variant,
  size,
  onClick,
  testId,
}: {
  readonly children: ReactNode;
  /** Why the button is off, or null when it is live. */
  readonly reason: string | null;
  readonly variant: ButtonVariant;
  readonly size: ButtonSize;
  readonly onClick: () => void;
  readonly testId: string;
}): ReactNode {
  if (reason !== null) {
    return (
      <Button variant={variant} size={size} disabled disabledReason={reason} data-testid={testId}>
        {children}
      </Button>
    );
  }

  return (
    <Button variant={variant} size={size} onClick={onClick} data-testid={testId}>
      {children}
    </Button>
  );
}
