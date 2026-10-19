/**
 * Stands in for `backend/api/src/adapters/mapping.ts` in the Django run.
 *
 * Everything is the real module's, except that a provider a test installs
 * (`setMappingProvider`) is also what the Django server asks for suggestions
 * (`bridge.ts`): the test's own `propose` answers, or throws, for the server.
 */

import {
  resetMappingProvider as resetReal,
  setMappingProvider as setReal,
} from '../../../api/src/adapters/mapping.js';

import { bridgeAdapter } from './bridge.js';

export * from '../../../api/src/adapters/mapping.js';

export function setMappingProvider(provider: Parameters<typeof setReal>[0]): void {
  setReal(provider);
  bridgeAdapter('mapping', provider);
}

export function resetMappingProvider(): ReturnType<typeof resetReal> {
  bridgeAdapter('mapping', null);
  return resetReal();
}
