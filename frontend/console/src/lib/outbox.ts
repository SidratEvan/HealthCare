/**
 * Where this console keeps what it has not sent yet (`FR-OFF-01`).
 *
 * One IndexedDB database per signed-in person on this device
 * (`@platform/client` `openConsoleStores`), holding the queue's, the ward's
 * and the ER's outboxes. Named for the person because what waits here is sent
 * later under whatever token the console then holds, and an event belongs to
 * whoever took the action (`FR-QUE-04`): the evening receptionist's sign-in
 * must not send the afternoon receptionist's unsent work as her own.
 */

import { openConsoleStores, ownerOfToken, type ConsoleStores } from '@platform/client';

import { readDemoSession } from '@/lib/demo';

/** The outboxes of whoever is signed in to this tab. */
export function consoleStores(): ConsoleStores {
  return openConsoleStores(ownerOfToken(readDemoSession()?.token ?? null));
}
