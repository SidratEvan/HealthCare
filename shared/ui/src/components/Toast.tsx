/**
 * Toast (FRONTEND.md §5.7).
 *
 * "Bottom-anchored mobile, bottom-right console. Max one at a time; a new
 * toast replaces the old. Undo toasts persist 10 s with a visible progress
 * line (`GR-02`). Toasts never carry critical information alone."
 *
 * ## One at a time is enforced, not requested
 *
 * `useToast` holds a single toast, not a queue. A stack of toasts over a
 * console is how a receptionist misses the one that mattered, and §5.7 says
 * max one — so the provider has no array to grow.
 *
 * ## The undo window is visible
 *
 * `GR-02`: undo appends a compensating event rather than erasing history, and
 * the person needs to know how long they have to use it. The progress line is
 * a CSS animation rather than a timer in state: it cannot drift from the
 * actual timeout, and it costs no re-renders while it runs.
 *
 * "Toasts never carry critical information alone" is a rule for callers, not
 * something a component can check — so the type requires a `title` and keeps
 * the action optional, making a bare toast the cheap thing to write.
 */

'use client';

// Holds the one live toast and its timer.
import * as RadixToast from '@radix-ui/react-toast';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { cx } from './cx.js';

import type { ReactNode } from 'react';

/** §5.7: an undo toast persists ten seconds. */
export const UNDO_DURATION_MS = 10_000;

/** Everything else is gone in four, which is long enough to read one line. */
export const DEFAULT_DURATION_MS = 4_000;

export type ToastTone = 'neutral' | 'positive' | 'caution' | 'alert';

export interface ToastRequest {
  readonly title: string;
  readonly description?: string;
  readonly tone?: ToastTone;
  /** Usually undo (`GR-02`). Its presence extends the toast to ten seconds. */
  readonly action?: { readonly label: string; readonly onAction: () => void };
}

interface ToastContextValue {
  readonly show: (request: ToastRequest) => void;
  readonly dismiss: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE: Record<ToastTone, string> = {
  neutral: 'bg-inverse text-ink-inverse border-inverse',
  positive: 'bg-brand-600 text-white border-brand-600',
  caution: 'bg-warn-100 text-warn-700 border-warn-border',
  alert: 'bg-alert-600 text-white border-alert-600',
};

export interface ToastProviderProps {
  readonly children: ReactNode;
  /** Bottom-centre on mobile, bottom-right on the console (§5.7). */
  readonly placement?: 'mobile' | 'console';
}

export function ToastProvider({ children, placement = 'mobile' }: ToastProviderProps): ReactNode {
  // One toast, never a queue — see the note above.
  const [toast, setToast] = useState<ToastRequest | null>(null);
  const [instance, setInstance] = useState(0);

  const show = useCallback((request: ToastRequest) => {
    setToast(request);
    // A fresh key remounts the toast, so a replacement restarts its timer and
    // its progress line rather than inheriting the previous one's.
    setInstance((previous) => previous + 1);
  }, []);

  const dismiss = useCallback(() => {
    setToast(null);
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ show, dismiss }), [show, dismiss]);
  const duration = toast?.action === undefined ? DEFAULT_DURATION_MS : UNDO_DURATION_MS;

  return (
    <ToastContext.Provider value={value}>
      <RadixToast.Provider duration={duration} swipeDirection="down">
        {children}

        {toast !== null ? (
          <RadixToast.Root
            key={instance}
            duration={duration}
            onOpenChange={(open) => {
              if (!open) setToast(null);
            }}
            className={cx(
              'relative overflow-hidden rounded-md border p-4 shadow-2',
              TONE[toast.tone ?? 'neutral'],
            )}
          >
            <RadixToast.Title className="font-ui text-body-md font-semibold">
              {toast.title}
            </RadixToast.Title>

            {toast.description !== undefined ? (
              <RadixToast.Description className="mt-1 font-ui text-body-sm opacity-90">
                {toast.description}
              </RadixToast.Description>
            ) : null}

            {toast.action !== undefined ? (
              <>
                <RadixToast.Action
                  asChild
                  altText={toast.action.label}
                  onClick={toast.action.onAction}
                >
                  <button
                    type="button"
                    className="mt-3 min-h-touch rounded-sm px-3 font-ui text-body-sm font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
                  >
                    {toast.action.label}
                  </button>
                </RadixToast.Action>

                {/*
                  The visible undo window (GR-02). Driven by CSS over the same
                  duration Radix uses, so it cannot drift from the real
                  timeout, and it stops entirely under reduced motion — where
                  the toast simply waits out its ten seconds instead.
                */}
                <span
                  aria-hidden="true"
                  style={{ animationDuration: `${String(duration)}ms` }}
                  className="absolute inset-x-0 bottom-0 h-1 origin-left bg-current opacity-60 motion-safe:animate-[toast-progress_linear_1]"
                />
              </>
            ) : null}
          </RadixToast.Root>
        ) : null}

        <RadixToast.Viewport
          className={cx(
            'fixed z-50 flex w-full max-w-[420px] flex-col gap-2 p-5 outline-none',
            placement === 'mobile' ? 'bottom-0 left-1/2 -translate-x-1/2' : 'bottom-0 right-0',
          )}
        />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

/**
 * Shows a toast.
 *
 * Throws when there is no provider rather than silently doing nothing — a
 * toast that never appears is a confirmation a receptionist waited for and did
 * not get, and that is worth failing loudly in development.
 */
export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (value === null) {
    throw new Error('useToast must be used inside a <ToastProvider>.');
  }
  return value;
}
