/**
 * The national dashboard's calls to the API (BACKEND.md §7.7, `S-B-13`).
 *
 * Four reads, no parameters, no writes — the shapes are `gov.service`'s own.
 * Kept out of the screen for the reason `lib/admin.js` is: a screen reads as
 * a sequence of decisions, and a test can hand it a fake.
 *
 * ## Four requests, not one
 *
 * `S-B-10` makes one request because every section of it is one facility's
 * day. These four are different questions answered from different views with
 * different ages, and `BACKEND.md` §7.7 gives them separate routes; one that
 * fails — the heat map, say — should leave the capacity map standing rather
 * than taking the whole screen with it.
 *
 * ## Online-only, like the hospital dashboard
 *
 * Nothing here is an action, so there is nothing to queue. When the network
 * goes, the screen keeps what it last had and its ages keep ageing (`GR-03`).
 */

import { ApiClient } from '@platform/client';

import { API_BASE } from '@/lib/admin';

function client(token) {
  return new ApiClient({ baseUrl: API_BASE, getToken: () => token });
}

export const govApi = {
  async capacity(token) {
    return await client(token).get('/gov/capacity');
  },
  async erLoad(token) {
    return await client(token).get('/gov/er-load');
  },
  async signals(token) {
    return await client(token).get('/gov/signals');
  },
  async benchmarks(token) {
    return await client(token).get('/gov/benchmarks');
  },
};

/**
 * How a cell of the heat map is shaded, from nothing to the busiest hour.
 *
 * Five steps on the brand ramp (`FRONTEND.md` §1: a single hue plus neutral),
 * scaled to the day's own peak so a quiet district's busiest hour still reads
 * as its busiest. Zero is its own step: an hour nobody arrived is not the
 * palest shade of busy.
 */
export function heatLevel(cases, peak) {
  if (cases <= 0 || peak <= 0) return 0;
  const level = Math.ceil((cases / peak) * 4);
  return Math.min(4, Math.max(1, level));
}
