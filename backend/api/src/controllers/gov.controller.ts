/**
 * The national layer's endpoints (BACKEND.md §7.7, `S-B-13`).
 *
 * Thin by rule. Nothing here takes a parameter: there is no hospital to name,
 * no patient to ask about and no date range to widen — the windows are the
 * service's, and every figure is a district's or a kind's. A route with no
 * inputs has no input to get wrong.
 */

import * as govService from '../services/gov.service.js';

import type { Request, Response } from 'express';

/**
 * Aggregates are never cached. A proxy serving an hour-old capacity map would
 * hand somebody an hour-old figure under a fresh page, and its freshness line
 * would be the only thing on screen telling the truth.
 */
function send(res: Response, data: unknown): void {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, data });
}

/** `GET /gov/capacity` (`FR-GOV-01`). */
export async function getCapacity(_req: Request, res: Response): Promise<void> {
  send(res, await govService.capacity());
}

/** `GET /gov/er-load` (`FR-GOV-02`). */
export async function getErLoad(_req: Request, res: Response): Promise<void> {
  send(res, await govService.erLoad());
}

/** `GET /gov/signals` (`FR-GOV-03`). */
export async function getSignals(_req: Request, res: Response): Promise<void> {
  send(res, await govService.signals());
}

/** `GET /gov/benchmarks` (`FR-GOV-04`). */
export async function getBenchmarks(_req: Request, res: Response): Promise<void> {
  send(res, await govService.benchmarks());
}
