/**
 * Stands in for `backend/api/src/services/portal.service.ts` in the Django run.
 *
 * `hospitalLinkOrigin` reads the recorded portal domains through a cache that
 * the platform's domain write empties. That write happens in the Django
 * process, so the question is asked there too (`call.ts`); answered from this
 * process, it would be answered from a cache nothing here ever emptied.
 * Everything else is the real module's.
 */

import { callDjango } from './call.js';

import type * as Real from '../../../api/src/services/portal.service.js';

export * from '../../../api/src/services/portal.service.js';

export const hospitalLinkOrigin: (typeof Real)['hospitalLinkOrigin'] = async (hospitalId) =>
  await callDjango('portals.hospitalLinkOrigin', hospitalId);
