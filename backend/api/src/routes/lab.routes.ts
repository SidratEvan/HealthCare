/**
 * Lab and pharmacy routes (BACKEND.md §7.6, `FR-LAB-*`, `FR-PHR-02`).
 *
 * ## Who may do what
 *
 * **Ordering is the doctor's** (`FR-DOC-06`, `R3`). The patient and the
 * hospital are read from the booking in the service, never taken from the
 * body, so the role is the whole of the route's guard and the relationship is
 * the service's.
 *
 * **Working an order is the lab's** (`R7`). `hospital_admin` is allowed
 * alongside, as it is on the ward and the ER: an administrator covering a
 * bench at nine at night is the situation this product is built for, and a
 * role they cannot use is a screen they cannot open.
 *
 * **The shelf is the pharmacy's** (`R8`), and the availability search behind
 * it is **public** — a stock flag names no patient and no staff member, and
 * it sits beside hospital discovery, which is public for the same reason.
 *
 * Every write takes an idempotency key: the lab console replays what it
 * queued offline (`FR-OFF-01`).
 *
 * ## The one route with its own body limit
 *
 * `POST /test-orders/:id/report` carries the report file. The global limit is
 * 256kb (`app.ts`); ten megabytes of PDF is about 13.4 after base64, so this
 * route parses its own body at 14mb and every other route stays small.
 */

import { Router, json } from 'express';
import { z } from 'zod';

import {
  createTestOrdersBody,
  labQueueQuery,
  medicineSearchQuery,
  stockFlagsBody,
  testOrderParams,
  testOrderStateBody,
  uploadReportBody,
} from '@platform/domain';

import * as lab from '../controllers/lab.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { idempotency } from '../middleware/idempotency.js';
import { requireHospitalScope, requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';

export const labRoutes: Router = Router();

const write = idempotency({ required: true });
const doctor = [requireAuth, requireRole('doctor')];
const bench = [requireAuth, requireRole('lab', 'hospital_admin')];
const counter = [requireAuth, requireRole('pharmacy', 'hospital_admin')];

const hospitalParams = z.object({ hospitalId: z.string().uuid() });

/** Ten megabytes of file, plus base64's third, plus room for the envelope. */
const REPORT_BODY_LIMIT = '14mb';

// --- Ordering (`FR-DOC-06`, `FR-LAB-01`) ------------------------------------

labRoutes.get('/lab/catalogue', ...doctor, lab.catalogue);

labRoutes.post(
  '/test-orders',
  ...doctor,
  write,
  validate({ body: createTestOrdersBody }),
  lab.order,
);

// --- The bench (`S-B-08`, `FR-LAB-02`, `FR-LAB-03`) -------------------------

labRoutes.get(
  '/hospitals/:hospitalId/test-orders',
  ...bench,
  requireHospitalScope(),
  validate({ params: hospitalParams, query: labQueueQuery }),
  lab.queue,
);

labRoutes.patch(
  '/test-orders/:id/state',
  ...bench,
  write,
  validate({ params: testOrderParams, body: testOrderStateBody }),
  lab.advance,
);

labRoutes.post(
  '/test-orders/:id/report',
  // Before auth so a rejected oversized body never reaches the guard, and
  // scoped to this route so the global limit stays 256kb.
  json({ limit: REPORT_BODY_LIMIT }),
  ...bench,
  write,
  validate({ params: testOrderParams, body: uploadReportBody }),
  lab.uploadReport,
);

// The name a bench calls somebody to the counter by. Its own route rather
// than a column on the queue, because it is the one identifying read on this
// screen and a separate call is what makes it auditable later (`DB-P7`).
labRoutes.get(
  '/test-orders/:id/patient',
  ...bench,
  validate({ params: testOrderParams }),
  lab.patientLabel,
);

// --- The pharmacy (`S-B-09`, `FR-PHR-02`) -----------------------------------

labRoutes.get(
  '/hospitals/:hospitalId/pharmacy-stock',
  ...counter,
  requireHospitalScope(),
  validate({ params: hospitalParams }),
  lab.shelf,
);

labRoutes.put(
  '/hospitals/:hospitalId/pharmacy-stock',
  ...counter,
  requireHospitalScope(),
  write,
  validate({ params: hospitalParams, body: stockFlagsBody }),
  lab.setFlags,
);

// Public: what a family searching from a bus is told (`FR-PHR-02`).
labRoutes.get('/medicines', validate({ query: medicineSearchQuery }), lab.searchMedicines);

/**
 * `GET /files/:key` — serves an object the mock store holds (`FR-LAB-03`).
 *
 * Public by URL and private by signature: the query carries an expiry and an
 * HMAC over the key, and anything else is refused. That is the same promise
 * a Supabase signed URL makes, which is why the patient app can open a report
 * the same way under either provider and why this route disappears rather
 * than changing when the bucket arrives.
 *
 * It is mounted here rather than in its own router because it exists only to
 * serve what `POST /test-orders/:id/report` stored.
 */
labRoutes.get('/files/:key', lab.serveFile);
