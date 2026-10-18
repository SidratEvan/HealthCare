/**
 * Stands in for `backend/api/src/adapters/sms.ts` in the Django run.
 *
 * Everything is the real module's, except that an adapter a test installs is
 * also where the Django server's SMS calls go (`bridge.ts`): the test's own
 * `send`, `verifyReceipt` and `readReceipt` answer for the server.
 */

import {
  resetSmsAdapter as resetReal,
  setSmsAdapter as setReal,
} from '../../../api/src/adapters/sms.js';

import { bridgeAdapter } from './bridge.js';

export * from '../../../api/src/adapters/sms.js';

export function setSmsAdapter(adapter: Parameters<typeof setReal>[0]): void {
  setReal(adapter);
  bridgeAdapter('sms', adapter);
}

export function resetSmsAdapter(): ReturnType<typeof resetReal> {
  bridgeAdapter('sms', null);
  return resetReal();
}
