/**
 * Stands in for `backend/api/src/adapters/payments/index.ts` in the Django run.
 *
 * Everything is the real module's, except that a provider a test installs
 * (`setPaymentProvider`) is also the Django server's provider for every online
 * method (`bridge.ts`), as it is the Node API's.
 */

import {
  resetPaymentProvider as resetReal,
  setPaymentProvider as setReal,
} from '../../../api/src/adapters/payments/index.js';

import { bridgeAdapter } from './bridge.js';

export * from '../../../api/src/adapters/payments/index.js';

export function setPaymentProvider(provider: Parameters<typeof setReal>[0]): void {
  setReal(provider);
  bridgeAdapter('payments', provider);
}

export function resetPaymentProvider(): ReturnType<typeof resetReal> {
  bridgeAdapter('payments', null);
  return resetReal();
}
