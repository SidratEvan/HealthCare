/**
 * Stands in for `backend/api/src/adapters/sms.ts` in the Django run.
 *
 * Everything is the real module's, except that an adapter a test installs is
 * also where the Django server's messages go (`bridge.ts`): the test's own
 * `send` is called with the message the server would have sent, and its
 * answer is the server's answer.
 */

import {
  resetSmsAdapter as resetReal,
  setSmsAdapter as setReal,
  type SmsAdapter,
} from '../../../api/src/adapters/sms.js';

import { bridgeSms } from './bridge.js';

export * from '../../../api/src/adapters/sms.js';

type Installed = Parameters<typeof setReal>[0];

export function setSmsAdapter(adapter: Installed): void {
  setReal(adapter);
  bridgeSms(async (message) => await (adapter as SmsAdapter).send(message as Parameters<SmsAdapter['send']>[0]));
}

export function resetSmsAdapter(): ReturnType<typeof resetReal> {
  bridgeSms(null);
  return resetReal();
}
