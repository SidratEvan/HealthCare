/**
 * Stands in for `backend/api/src/services/modules.service.ts` in the Django run.
 *
 * A test that switches a hospital's modules in the database calls
 * `forgetModules` so the next question reads them again, and so the
 * hospital's sockets are closed and rejoin. The cache and the sockets that
 * matter are the Django server's, so the call is made there too
 * (`call.ts`). It stays synchronous here, as the real one is: the bridge
 * holds every request the test sends next until the server has done it
 * (`bridge.ts` `track`). Everything else is the real module's.
 */

import * as real from '../../../api/src/services/modules.service.js';

import { track } from './bridge.js';
import { callDjango } from './call.js';

export * from '../../../api/src/services/modules.service.js';

export const forgetModules: typeof real.forgetModules = (hospitalId) => {
  real.forgetModules(hospitalId);
  track(callDjango('modules.forgetModules', hospitalId ?? null));
};
