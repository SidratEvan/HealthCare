/**
 * Stands in for `backend/api/src/realtime/auth.ts` in the Django run.
 *
 * Everything is the real module's except `sweepRevoked`, which a test calls to
 * run the periodic sweep now: here it runs the Django process's sweep through
 * the test seam (`/__test__/realtime/sweep`) and answers its count.
 */

import { DJANGO_API_URL } from './app-shim.js';

export * from '../../../api/src/realtime/auth.js';

export async function sweepRevoked(): Promise<number> {
  const answer = await fetch(`${DJANGO_API_URL}/__test__/realtime/sweep`, { method: 'POST' });
  const body = (await answer.json()) as { data: number };
  return body.data;
}
