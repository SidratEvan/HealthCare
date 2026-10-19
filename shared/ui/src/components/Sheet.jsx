/**
 * Bottom sheet and modal (FRONTEND.md §5.6).
 *
 * "Mobile uses sheets (`radius-lg` top corners, drag handle, backdrop 40%
 * `--ink-primary`); console uses centred modals. Both trap focus, close on
 * `Esc`, and restore focus on close."
 *
 * Built on Radix Dialog, which is where the focus trap, the `Esc` handling,
 * the focus restore and the `aria-modal` wiring come from — behaviour for
 * free, with no inherited visual identity (FRONTEND.md §9: "Radix gives
 * behaviour; the visual layer is entirely ours").
 *
 * ## The safe option goes on the left
 *
 * `GR-01`, via §5.6: "Destructive confirmations state the consequence in the
 * body and put the safe option on the left." `<SheetActions destructive>`
 * renders its children in that order, so the rule is applied by the component
 * rather than remembered at each call site — which is the only way a rule
 * about button order survives twenty screens.
 */

'use client';

// Radix owns the focus trap and the escape handling, both of which are
// browser behaviour.
import * as Dialog from '@radix-ui/react-dialog';

import { useConsoleBrandStyle } from '../console/ConsoleFoundation.jsx';

import { cx } from './cx.js';

export function Sheet({
  className,
  restoreFocusTo,
  console: consoleScope = false,
  open,
  onOpenChange,
  title,
  description,
  children,
  trigger,
  variant = 'sheet',
  dismissible = true,
}) {
  const brandStyle = useConsoleBrandStyle();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger !== undefined ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}

      <Dialog.Portal>
        {/* §5.6: backdrop is 40% ink, not black — the ground stays warm.
            Above everything fixed on the page, the patient app's bottom
            navigation (`z-40`) included: a sheet that slid under the nav hid
            its own primary button behind it. */}
        <Dialog.Overlay
          className={
            consoleScope ? 'console-foundation cf-overlay' : 'fixed inset-0 z-50 bg-ink/40'
          }
          style={consoleScope ? brandStyle : undefined}
        />

        <Dialog.Content
          onCloseAutoFocus={
            restoreFocusTo === undefined
              ? undefined
              : (event) => {
                  const target = restoreFocusTo();
                  if (target?.isConnected) {
                    event.preventDefault();
                    target.focus();
                  }
                }
          }
          style={consoleScope ? brandStyle : undefined}
          onKeyDown={(event) => {
            if (consoleScope) event.stopPropagation();
          }}
          onPointerDownOutside={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          className={
            consoleScope
              ? cx('console-foundation cf-dialog cf-reception-dialog', className)
              : cx(
                  'fixed z-50 bg-surface shadow-2 focus:outline-none',
                  variant === 'sheet'
                    ? // Rises from the bottom, rounded on the top corners only.
                      // A tall sheet on a short phone scrolls rather than pushing its
                      // action off the screen.
                      'inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-lg p-5 motion-safe:duration-sheet motion-safe:ease-sheet'
                    : 'left-1/2 top-1/2 w-full max-w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-lg p-6',
                )
          }
        >
          {variant === 'sheet' ? (
            // The drag handle. Decorative: the sheet is closed by Esc, the
            // backdrop or an explicit action, all of which are reachable.
            <div aria-hidden="true" className="mx-auto mb-4 h-1 w-10 rounded-pill bg-line-strong" />
          ) : null}

          <Dialog.Title className="font-ui text-title-md text-ink">{title}</Dialog.Title>

          {description !== undefined ? (
            <Dialog.Description className="mt-2 font-ui text-body-md text-ink-secondary">
              {description}
            </Dialog.Description>
          ) : null}

          <div className="mt-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SheetActions({ children, destructive = false }) {
  return (
    <div className={cx('flex gap-3', destructive ? 'flex-row-reverse' : 'flex-row')}>
      {children}
    </div>
  );
}

/** Closes the sheet from inside it, keeping Radix's focus restore. */
export const SheetClose = Dialog.Close;
