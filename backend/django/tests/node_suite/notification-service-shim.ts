/**
 * Stands in for `backend/api/src/services/notification.service.ts` in the Django run.
 *
 * The messages a request wrote are sent by the Django process's sender, so
 * waiting for "everything this test caused has gone" (`settled`) waits for
 * that sender. A batch a test queued itself is handed to the same sender
 * (`dispatch`), and forgetting the template cache forgets both processes'.
 * Everything else is the real module's.
 */

import * as real from '../../../api/src/services/notification.service.js';

import { callDjango } from './call.js';

export * from '../../../api/src/services/notification.service.js';

export async function settled(): Promise<void> {
  await real.settled();
  await callDjango('notifications.settled');
}

export async function dispatch(batch: Parameters<typeof real.dispatch>[0]): Promise<void> {
  await callDjango('notifications.dispatch', batch);
}

export function forgetTemplates(): void {
  real.forgetTemplates();
  void callDjango('notifications.forgetTemplates');
}
