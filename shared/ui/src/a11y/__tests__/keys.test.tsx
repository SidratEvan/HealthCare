/**
 * `useWindowKeydown` — a key is answered by the screen as it stands
 * (`A11Y-05`, `APP_FLOW.md` D4).
 *
 * The reception console used to put its key listener on in an effect that ran
 * after each redraw. For about a frame after the screen changed, a key was
 * still handled by the screen before it. On 3 October CI pressed N in that
 * frame: the break had just ended on screen, and the console answered "a break
 * is in progress" and called nobody (`e2e/pause-resume.spec.ts`).
 *
 * These tests press in that frame on purpose, so the result does not depend
 * on how fast the machine is.
 */

import { render } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useWindowKeydown } from '../keys.js';

import type { ReactNode } from 'react';

type Heard = (shows: string, event: KeyboardEvent) => void;

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

/** A screen that says what it shows when a key reaches it. */
function Screen({ shows, heard }: { readonly shows: string; readonly heard: Heard }): ReactNode {
  useWindowKeydown((event) => {
    heard(shows, event);
  });
  return <p>{shows}</p>;
}

/**
 * Presses a key at the earliest moment one can find a redrawn screen.
 *
 * React redraws and runs layout effects in one task. What it calls passive
 * effects may run in a later one, and a key the browser delivers between the
 * two finds the page as the layout phase left it. A parent's layout effect is
 * the last thing in that phase, after the screen's own, so pressing here is
 * pressing then.
 */
function PressOnRedraw({
  pressKey,
  children,
}: {
  readonly pressKey: string | null;
  readonly children: ReactNode;
}): ReactNode {
  useLayoutEffect(() => {
    if (pressKey !== null) press(pressKey);
  });
  return children;
}

describe('useWindowKeydown (A11Y-05)', () => {
  it('answers a key pressed the instant the screen is redrawn with what the redraw shows', () => {
    const heard = vi.fn<Heard>();
    const { rerender } = render(
      <PressOnRedraw pressKey={null}>
        <Screen shows="paused" heard={heard} />
      </PressOnRedraw>,
    );

    rerender(
      <PressOnRedraw pressKey="n">
        <Screen shows="running" heard={heard} />
      </PressOnRedraw>,
    );

    // Once, by the screen that is there — not by the one it replaced.
    expect(heard.mock.calls.map(([shows]) => shows)).toEqual(['running']);
  });

  it('keeps answering with the newest screen, however often it is redrawn', () => {
    const heard = vi.fn<Heard>();
    const { rerender } = render(<Screen shows="first" heard={heard} />);

    for (const shows of ['second', 'third', 'fourth']) {
      rerender(<Screen shows={shows} heard={heard} />);
      press('n');
    }

    expect(heard.mock.calls.map(([shows]) => shows)).toEqual(['second', 'third', 'fourth']);
  });

  it('hands over the key itself, so a shortcut can keep the browser from acting on it', () => {
    const { unmount } = render(
      <Screen
        shows="queue"
        heard={(_shows, event) => {
          event.preventDefault();
        }}
      />,
    );

    expect(press(' ').defaultPrevented).toBe(true);

    unmount();
    expect(press(' ').defaultPrevented).toBe(false);
  });

  it('answers nothing once the screen is gone, from the instant it goes', () => {
    const heard = vi.fn<Heard>();
    const { rerender } = render(
      <PressOnRedraw pressKey={null}>
        <Screen shows="panel" heard={heard} />
      </PressOnRedraw>,
    );

    rerender(<PressOnRedraw pressKey="Escape">{null}</PressOnRedraw>);
    press('Escape');

    expect(heard).not.toHaveBeenCalled();
  });
});
