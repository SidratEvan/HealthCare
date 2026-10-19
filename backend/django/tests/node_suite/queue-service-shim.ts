/**
 * Stands in for `backend/api/src/services/queue.service.ts` in the Django run.
 *
 * The functions a test calls directly run in the Django process (`call.ts`):
 * the event is written, reduced, broadcast and messaged by the Python queue
 * service, which is what the test's assertions are about. Everything else is
 * the real module's.
 */

import { callDjango } from './call.js';

import type * as Real from '../../../api/src/services/queue.service.js';

export * from '../../../api/src/services/queue.service.js';

type Fn<K extends keyof typeof Real> = (typeof Real)[K];

export const appendEvent: Fn<'appendEvent'> = async (input) =>
  await callDjango('queue.appendEvent', input);
export const callNext: Fn<'callNext'> = async (input) => await callDjango('queue.callNext', input);
export const appendBatch: Fn<'appendBatch'> = async (input) =>
  await callDjango('queue.appendBatch', input);
export const setCapacity: Fn<'setCapacity'> = async (sessionId, capacity) =>
  await callDjango('queue.setCapacity', sessionId, capacity);
export const createWalkinBooking: Fn<'createWalkinBooking'> = async (input) =>
  await callDjango('queue.createWalkinBooking', input);
export const getState: Fn<'getState'> = async (sessionId) =>
  await callDjango('queue.getState', sessionId);
export const waitingCount: Fn<'waitingCount'> = async (sessionId) =>
  await callDjango('queue.waitingCount', sessionId);
export const bookingOwner: Fn<'bookingOwner'> = async (bookingId) =>
  await callDjango('queue.bookingOwner', bookingId);
