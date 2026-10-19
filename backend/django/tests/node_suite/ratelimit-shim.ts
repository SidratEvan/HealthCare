/**
 * Stands in for `backend/api/src/middleware/rateLimit.ts` when the Node API
 * suite runs against the Django server (`vitest.django.config.ts`).
 *
 * Everything is the real module's. One thing changes: `counter.reset()`,
 * which a test calls to start from an empty window, also tells the Django
 * server to empty its own (`bridge.ts`, `x-medlive-test-rate-window`). The
 * Node API's counter lived in the test file's own process and started empty
 * with each file; the Django server's outlives files, so the window token
 * names the file too.
 */

import { counter as realCounter } from '../../../api/src/middleware/rateLimit.js';

import { startRateWindow } from './bridge.js';

export * from '../../../api/src/middleware/rateLimit.js';

export const counter: typeof realCounter = new Proxy(realCounter, {
  get(target, property, receiver) {
    if (property === 'reset') {
      return () => {
        target.reset();
        startRateWindow();
      };
    }
    const value: unknown = Reflect.get(target, property, receiver);
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(target)
      : value;
  },
});
