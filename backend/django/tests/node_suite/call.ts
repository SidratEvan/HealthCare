/**
 * Calls one of the Django process's service functions from a Node test, through
 * the test seam (`/__test__/call`, NODE_ENV=test only).
 *
 * A Node test that calls a service directly (`queueService.appendEvent(...)`)
 * and then asserts on what the *server* did (a broadcast it sent, an outbox
 * row it wrote) is asserting on the Django process here only if the call runs
 * there. The answer is the Python function's; a refusal is thrown as the Node
 * API's own `AppError`, with its code, message and details, so `rejects`
 * assertions read the same.
 */

import { AppError } from '../../../api/src/errors/AppError.js';

import { DJANGO_API_URL } from './app-shim.js';
import { bridgeHeaders, drained } from './bridge.js';

export async function callDjango<T>(fn: string, ...args: unknown[]): Promise<T> {
  // A forwarded call waits for those before it, but not for itself.
  if (fn !== 'modules.forgetModules') await drained();
  const response = await fetch(`${DJANGO_API_URL}/__test__/call`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-medlive-test-now': String(Date.now()),
      ...bridgeHeaders(),
    },
    body: JSON.stringify({ fn, args }),
  });
  const body = (await response.json()) as
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } };
  if (body.ok) return body.data;
  if (body.error.code === 'INTERNAL') throw new Error(`${fn}: ${body.error.message}`);
  throw new AppError(body.error.code as ConstructorParameters<typeof AppError>[0], {
    message: body.error.message,
    ...(body.error.details === undefined ? {} : { details: body.error.details }),
  });
}
