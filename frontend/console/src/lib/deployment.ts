'use client';

/**
 * Whether this server is a demonstration, as the server itself has said
 * (`GET /demo/status`, `FR-DEM-07`).
 *
 * Every console screen used to print "This is a demonstration. All data here
 * is for display only" whatever it was running against. On a hospital's own
 * server that line is false, and it is false in the direction that does harm:
 * it tells the person at the counter that the patient they are registering
 * does not count.
 *
 * So the line follows the server, and **nothing is said until the server has
 * answered**. A demonstration that goes a moment without its label has lost
 * nothing; a real queue that carries it for a moment has told somebody
 * something untrue. That is also why the answer is not remembered between
 * page loads: an answer from an earlier visit is a guess about this one.
 *
 * Held outside React, like the language (`@platform/ui` `locale/store`), so
 * the one question the page asks at load reaches every screen that draws the
 * line.
 */

import { useSyncExternalStore } from 'react';

/** Null until the server has answered in this page's lifetime. */
let demonstration: boolean | null = null;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): boolean {
  return demonstration === true;
}

function serverSnapshot(): boolean {
  return false;
}

/** Records what the server said. Called by whoever asked (`askDemoMode`). */
export function rememberDemonstration(answer: boolean): void {
  if (demonstration === answer) return;
  demonstration = answer;
  for (const listener of listeners) listener();
}

/** True only once the server has said this is a demonstration. */
export function useIsDemonstration(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
