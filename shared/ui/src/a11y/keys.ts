/**
 * Keys pressed anywhere on a screen (`A11Y-05`, `APP_FLOW.md` D4).
 *
 * The console is worked from the keyboard by people who are not looking at
 * the mouse, so a shortcut has to mean what the screen in front of them says
 * it means. `useWindowKeydown` is the one way a screen listens for them.
 *
 * ## Why this is not an effect with the handler in its dependencies
 *
 * That is the natural way to write it, and it is what the reception console
 * did: take the old listener off and put the new one on, in an effect, each
 * time the screen was redrawn. React runs such an effect *after* the redraw,
 * and may leave a frame between the two. A key pressed in that frame was
 * answered by the screen before it — N, pressed as the break ended, was told
 * "a break is in progress" and nobody was called (`e2e/pause-resume.spec.ts`).
 * The same frame followed every redraw, and the console redraws at least once
 * a second.
 *
 * So the listener goes on once, and what it calls is changed inside the
 * redraw itself. A layout effect runs in the same task as the change to the
 * page, before the browser can deliver anything else: there is no moment at
 * which the page shows one screen and the keys belong to another, and none
 * after a screen has gone at which it still answers.
 */

'use client';

import { useLayoutEffect, useRef } from 'react';

/**
 * Calls `handler` for every key pressed while the calling screen is shown.
 *
 * `handler` may be a new function on every render, and usually is: it is
 * never a reason to listen again.
 */
export function useWindowKeydown(handler: (event: KeyboardEvent) => void): void {
  const latest = useRef(handler);

  useLayoutEffect(() => {
    latest.current = handler;
  });

  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      latest.current(event);
    };

    globalThis.addEventListener('keydown', onKey);
    return () => {
      globalThis.removeEventListener('keydown', onKey);
    };
  }, []);
}
