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

import * as Dialog from '@radix-ui/react-dialog';

import { cx } from './cx.js';

import type { ReactNode } from 'react';

export interface SheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Required: an unlabelled dialog is announced as nothing at all. */
  readonly title: string;
  /** Shown under the title; also the accessible description. */
  readonly description?: string;
  readonly children: ReactNode;
  /**
   * The control that opens it.
   *
   * Passing it here rather than rendering it outside is what gives Radix the
   * element to **return focus to** when the sheet closes (§5.6). A sheet
   * opened by a button it does not know about leaves a keyboard user at the
   * top of the document when it shuts.
   */
  readonly trigger?: ReactNode;
  /** `sheet` rises from the bottom (mobile); `modal` is centred (console). */
  readonly variant?: 'sheet' | 'modal';
  /**
   * Whether a tap on the backdrop closes it.
   *
   * False for a destructive confirmation — §5.6 requires "no
   * dismiss-by-accident" for the delay sheet, and the same reasoning applies
   * wherever the answer matters.
   */
  readonly dismissible?: boolean;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  trigger,
  variant = 'sheet',
  dismissible = true,
}: SheetProps): ReactNode {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger !== undefined ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}

      <Dialog.Portal>
        {/* §5.6: backdrop is 40% ink, not black — the ground stays warm. */}
        <Dialog.Overlay className="fixed inset-0 bg-ink/40" />

        <Dialog.Content
          onPointerDownOutside={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          className={cx(
            'fixed bg-surface shadow-2 focus:outline-none',
            variant === 'sheet'
              ? // Rises from the bottom, rounded on the top corners only.
                'inset-x-0 bottom-0 rounded-t-lg p-5 motion-safe:duration-sheet motion-safe:ease-sheet'
              : 'left-1/2 top-1/2 w-full max-w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-lg p-6',
          )}
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

export interface SheetActionsProps {
  readonly children: ReactNode;
  /**
   * Puts the safe option on the left (`GR-01`).
   *
   * `row-reverse` rather than reordering the children, so the caller still
   * writes them in the order they think about them — destructive action
   * first, the way the sentence reads — and the layout does the rest.
   */
  readonly destructive?: boolean;
}

export function SheetActions({ children, destructive = false }: SheetActionsProps): ReactNode {
  return (
    <div className={cx('flex gap-3', destructive ? 'flex-row-reverse' : 'flex-row')}>
      {children}
    </div>
  );
}

/** Closes the sheet from inside it, keeping Radix's focus restore. */
export const SheetClose = Dialog.Close;
