/**
 * Thin by design (BACKEND.md §3: "controllers — thin: parse → call service →
 * shape response").
 *
 * No SQL, no events, no notifications. Lint enforces all three.
 */

import { liveness, readiness } from '../services/health.service.js';

import type { Request, Response } from 'express';

/** `GET /healthz` — liveness. Answers without touching the database. */
export function getHealth(_req: Request, res: Response): void {
  res.json({ ok: true, data: liveness() });
}

/**
 * `GET /readyz` — readiness.
 *
 * 503 when a dependency is down, because a load balancer reads the status code
 * and not the body (`SERVICE_UNAVAILABLE`, BACKEND.md §9).
 */
export async function getReady(_req: Request, res: Response): Promise<void> {
  const result = await readiness();
  res.status(result.status === 'ready' ? 200 : 503).json({ ok: true, data: result });
}
