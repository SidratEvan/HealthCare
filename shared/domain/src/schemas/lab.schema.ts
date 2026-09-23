/**
 * Request shapes for the lab and pharmacy endpoints (BACKEND.md §7.6,
 * `FR-LAB-*`, `FR-PHR-02`).
 *
 * Shared for the reason the referral schemas are: the lab console queues its
 * state buttons offline (`FR-OFF-01`) and replays them on reconnect, and a
 * body a console can build but the server rejects is one discovered at the
 * worst possible moment.
 */

import { z } from 'zod';

import { LAB_ACTIONS } from '../lab/orders.js';

import { queueCommandEnvelope } from './queue.schema.js';

const uuid = z.string().uuid();

/** The same envelope every offline-capable command carries (`SY-02`). */
export const labCommandEnvelope = queueCommandEnvelope;

/**
 * How long a test code and name may be.
 *
 * A code is a catalogue key (`CBC`, `XR-CHEST`); a name is what the patient
 * reads on their wallet row, so it is allowed to be a sentence.
 */
export const TEST_CODE_MAX = 32;
export const TEST_NAME_MAX = 120;

/**
 * `POST /test-orders` — `BTN-B05-TEST` on the doctor console (`FR-DOC-06`,
 * `FR-LAB-01`).
 *
 * The patient and the hospital are **not** in the body: they are read from
 * the booking on the server. A console that could name the patient a test is
 * ordered for is a console that could put one patient's result in another
 * patient's wallet, which is the one mistake this table must not make.
 *
 * Several tests are ordered in one request because a doctor ticks several
 * chips before saving, and one round trip on a bad connection is the point
 * (`NFR-04`). Each becomes its own `test_orders` row: they are collected,
 * processed and reported separately.
 */
export const createTestOrdersBody = labCommandEnvelope.extend({
  /** The consultation these came out of. */
  bookingId: uuid,
  tests: z
    .array(
      z.object({
        testCode: z.string().trim().min(1).max(TEST_CODE_MAX),
        /**
         * Optional: the server fills it from the hospital's catalogue when the
         * code is one it knows, so a console cannot rename a test on the way
         * through. Sent only for a code the catalogue does not have.
         */
        testName: z.string().trim().min(1).max(TEST_NAME_MAX).optional(),
      }),
    )
    .min(1)
    .max(20),
  idempotencyKey: uuid,
});

export type CreateTestOrdersBody = z.infer<typeof createTestOrdersBody>;

export const testOrderParams = z.object({ id: uuid });

/**
 * `PATCH /test-orders/:id/state` — the lab's state buttons (`FR-LAB-02`).
 *
 * `deliver` is not an action a console may send: `FR-LAB-03` makes delivery
 * the server's own step, taken when a report actually reaches a wallet. The
 * enum comes from `LAB_ACTIONS`, which leaves it out for that reason.
 */
export const testOrderStateBody = labCommandEnvelope.extend({
  action: z.enum(LAB_ACTIONS),
  idempotencyKey: uuid,
});

export type TestOrderStateBody = z.infer<typeof testOrderStateBody>;

/** What a report file may be (`FR-LAB-03`: "PDF or image"). */
export const REPORT_FILE_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** The largest report this version accepts, in bytes. */
export const REPORT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * `POST /test-orders/:id/report` — upload, then auto-deliver (`FR-LAB-03`).
 *
 * The file arrives base64-encoded in JSON rather than as multipart, because
 * every other endpoint in this API is JSON and a second body parser is a
 * dependency and a middleware branch for one route. Ten megabytes is the
 * ceiling; base64 inflates by a third, which the route's body limit accounts
 * for.
 *
 * `fileName` is only ever used to derive an extension — never to build a path.
 * The stored object is keyed by the report's own id, so a file called
 * `../../etc/passwd` is a file called nothing.
 */
export const uploadReportBody = labCommandEnvelope.extend({
  fileType: z.enum(REPORT_FILE_TYPES),
  fileName: z.string().trim().min(1).max(200).optional(),
  /** Base64, without a `data:` prefix. */
  content: z.string().min(1),
  idempotencyKey: uuid,
});

export type UploadReportBody = z.infer<typeof uploadReportBody>;

/**
 * `GET /hospitals/:id/test-orders` — the lab queue (`S-B-08`).
 *
 * Defaults to what the lab still has work on, because that is the screen's
 * job. `state=all` is what the turnaround figures are computed over.
 */
export const labQueueQuery = z.object({
  state: z.enum(['open', 'reported', 'all']).default('open'),
  /** How far back a non-open list reaches, in days. */
  days: z.coerce.number().int().min(1).max(90).default(7),
});

export type LabQueueQuery = z.infer<typeof labQueueQuery>;

// ---------------------------------------------------------------------------
// Pharmacy (`FR-PHR-02`)
// ---------------------------------------------------------------------------

/**
 * `PUT /hospitals/:id/pharmacy-stock` — `S-B-09`'s flags.
 *
 * The pharmacy confirms a list, not one switch, for the reason
 * `capabilitiesBody` does: every row named is stamped with this person and
 * this instant, so re-sending an unchanged flag is how somebody says "still
 * true" and the freshness a patient sees is renewed (`FR-PHR-02`). A flag
 * nobody renews goes quiet on its own (`stockAnswerFor`), which is the
 * honest outcome rather than a claim that outlives its check.
 */
export const stockFlagsBody = labCommandEnvelope.extend({
  flags: z
    .array(z.object({ medicineId: uuid, inStock: z.boolean() }))
    .min(1)
    .max(200),
  idempotencyKey: uuid,
});

export type StockFlagsBody = z.infer<typeof stockFlagsBody>;

/**
 * `GET /medicines?q=&lat=&lng=` — the patient's availability search.
 *
 * `q` matches generic or brand name. Position is optional and, when absent,
 * the results are ranked by freshness instead of distance — the app does not
 * ask for location before it has something to show (`S-A-01` is not built).
 */
export const medicineSearchQuery = z.object({
  q: z.string().trim().min(2).max(80),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type MedicineSearchQuery = z.infer<typeof medicineSearchQuery>;
