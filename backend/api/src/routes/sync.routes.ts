/**
 * Sync routes (BACKEND.md §5.1).
 *
 * Two of the three rows in that table. `POST /sync/cursor` writes
 * `sync_cursors`, which migration `0010_messaging_audit.sql` creates and the
 * schema stops at 0006 — so it is not mounted. Nothing is lost in the
 * meantime: the cursor it would store is the device's own `lastSeq`, which the
 * console already keeps in its local queue and sends on every pull. The
 * server-side copy is for telemetry and for a device that has lost its
 * storage, and it arrives with the migration.
 *
 * Both routes are staff-only, checked against the session's hospital in the
 * controller (`FR-ROLE-01`). Sync is a console protocol: a patient's app reads
 * the session channel and has no offline queue to replay.
 */

import { Router } from 'express';

import { syncBatchBody, syncParams, syncPullQuery } from '@platform/domain';

import * as sync from '../controllers/sync.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { idempotency } from '../middleware/idempotency.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';

export const syncRoutes: Router = Router();

/**
 * Every role that sits at a counter or a chamber.
 *
 * Wider than the queue routes deliberately: those name the role allowed to
 * *take* an action, while this replays actions already taken and already
 * attributed. A doctor's console queues events offline exactly as reception's
 * does, and refusing its replay would strand them.
 */
const CONSOLE_ROLES = ['receptionist', 'doctor', 'hospital_admin'] as const;

/**
 * `POST /sync/events` — replay a batch.
 *
 * No `idempotency({ required: true })`, unlike the online queue writes. Every
 * entry already carries its own `clientEventId` and the whole batch is
 * idempotent by construction (`SY-02`), so a request-level key would be a
 * second, weaker key guarding the same thing — and one that a retry of a
 * partially-applied batch would get wrong.
 */
syncRoutes.post(
  '/sync/events',
  requireAuth,
  requireRole(...CONSOLE_ROLES),
  idempotency(),
  validate({ body: syncBatchBody }),
  sync.pushEvents,
);

/** `GET /sync/session/:id?sinceSeq=` — what the device missed. */
syncRoutes.get(
  '/sync/session/:id',
  requireAuth,
  requireRole(...CONSOLE_ROLES),
  validate({ params: syncParams, query: syncPullQuery }),
  sync.pullSession,
);
