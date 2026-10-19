/**
 * Stands in for `backend/api/src/services/heartbeat.service.ts` in the Django run.
 *
 * A test that registers a worker or records a beat (`heartbeat.beat('sender',
 * false)`) and then reads `/readyz` is asserting on what the server knows.
 * Every call here still changes the real module, so a test reading
 * `snapshot()` in its own process reads what it wrote; and each one is queued
 * for the Django server, which applies them in order before the next request
 * the test sends (`bridge.ts`, `x-medlive-test-heartbeat`, NODE_ENV=test only).
 * A beat with no time is stamped when it was made, as the Node module stamps it.
 */

import * as real from '../../../api/src/services/heartbeat.service.js';

import { queueHeartbeat } from './bridge.js';

export * from '../../../api/src/services/heartbeat.service.js';

export const register: typeof real.register = (worker, everyMs) => {
  real.register(worker, everyMs);
  queueHeartbeat({ op: 'register', worker, everyMs });
};

export const beat: typeof real.beat = (worker, ok, at = new Date()) => {
  real.beat(worker, ok, at);
  queueHeartbeat({ op: 'beat', worker, ok, at: at.getTime() });
};

export const reset: typeof real.reset = () => {
  real.reset();
  queueHeartbeat({ op: 'reset' });
};
