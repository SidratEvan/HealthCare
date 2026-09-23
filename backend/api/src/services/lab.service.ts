/**
 * The lab: ordering tests, working them through, and getting the report to
 * the patient (BACKEND.md §7.6; `FR-LAB-01..04`, `FR-DOC-06`).
 *
 * ## Every step runs the same way
 *
 *   1. **Lock** the order row. Two benches tapping the same button, or a
 *      state change racing an upload, serialise on it.
 *   2. **Decide** with `canActOnTestOrder` — the function the console ran
 *      before sending. An action whose outcome is already the order's state
 *      is a replay (`labOrderAlreadyApplied`), answered as a success without
 *      writing.
 *   3. **Write**, in one transaction with anything else the step does.
 *   4. **After commit**, broadcast into the hospital's lab room and dispatch
 *      whatever was queued — never before, so no console shows a step that
 *      rolled back and no patient gets a text about one.
 *
 * ## Delivery is not a button, and it is not a promise either
 *
 * `FR-LAB-03`: a report "auto-delivers to the patient wallet and the ordering
 * doctor". So uploading a report does the delivering, in the same
 * transaction: the file is stored, the `reports` row is written, the order
 * moves to `delivered`, and `reports.delivered_to` names who it reached. If
 * any of that fails the whole thing rolls back and the lab is told the upload
 * failed — which is true, and better than a report row that claims a delivery
 * that did not happen.
 *
 * The file is stored **before** the transaction opens. A storage call inside
 * a transaction holds a database connection for the length of a network round
 * trip, and an upload that fails after the rows are written would leave a
 * `file_url` pointing at nothing. Storing first means the worst case is an
 * orphaned object, which costs bytes; the other way round costs a patient a
 * report that will not open.
 *
 * ## Who may do what
 *
 * Ordering is the doctor's (`FR-DOC-06`) and is checked against the visit:
 * the patient and the hospital are read from the booking, never taken from
 * the request, so no console can put one patient's test in another patient's
 * wallet. Working the order is the lab's, scoped to the hospital that owns
 * it — `requireHospitalScope` on the route, and re-checked here against the
 * row, because a route guard reads a token and this reads the truth.
 */

import {
  canActOnTestOrder,
  canDeliverReport,
  canUploadReport,
  labOrderAlreadyApplied,
  sortLabQueue,
  summariseTurnaround,
  LAB_ACTION_RESULT,
  OPEN_TEST_STATES,
  REPORTED_TEST_STATES,
  type LabAction,
  type REPORT_FILE_TYPES,
  type TestOrderView,
  type TestState,
  type TurnaroundSummary,
} from '@platform/domain';

import { storage, verifyFileSignature } from '../adapters/storage.js';
import { logger } from '../config/logger.js';
import { AppError, forbiddenScope, notFound, validationFailed } from '../errors/AppError.js';
import * as emit from '../realtime/emit.js';
import * as labRepo from '../repositories/lab.repo.js';
import { withTransaction, type Tx } from '../repositories/transaction.js';

import * as notifications from './notification.service.js';

/** Who is acting, and where they are scoped. */
export interface LabActor {
  readonly staffUserId: string;
  readonly hospitalId: string;
}

/** What every lab write returns, and what a console reconciles against. */
export interface LabResult {
  readonly order: TestOrderView;
  /** True when this was a replay of something already applied. */
  readonly duplicate: boolean;
  readonly serverTs: string;
}

/**
 * The demo catalogue's prices, in poisha.
 *
 * Not a product decision and not commercial content (CLAUDE.md §1.1): these
 * are the demo hospital's list prices, the same standing the doctors' fees in
 * `seed_02` have, and they exist so a `test_orders` row has a number to carry
 * for `FR-ADM-04`. A real hospital's catalogue arrives with its agreement.
 *
 * The names are Bangla because the patient reads them on a wallet row.
 */
const DEMO_TEST_CATALOGUE: Readonly<Record<string, { nameBn: string; pricePoisha: number }>> = {
  CBC: { nameBn: 'সম্পূর্ণ রক্ত পরীক্ষা (CBC)', pricePoisha: 45_000 },
  'BLOOD-SUGAR': { nameBn: 'রক্তে শর্করা (FBS)', pricePoisha: 20_000 },
  'LIPID-PROFILE': { nameBn: 'লিপিড প্রোফাইল', pricePoisha: 90_000 },
  'SERUM-CREATININE': { nameBn: 'সিরাম ক্রিয়েটিনিন', pricePoisha: 50_000 },
  LFT: { nameBn: 'লিভার ফাংশন টেস্ট', pricePoisha: 120_000 },
  TSH: { nameBn: 'থাইরয়েড (TSH)', pricePoisha: 80_000 },
  'URINE-RE': { nameBn: 'প্রস্রাব পরীক্ষা (R/E)', pricePoisha: 25_000 },
  'XR-CHEST': { nameBn: 'বুকের এক্স-রে', pricePoisha: 60_000 },
  ECG: { nameBn: 'ইসিজি', pricePoisha: 40_000 },
  ECHO: { nameBn: 'ইকোকার্ডিওগ্রাম', pricePoisha: 250_000 },
  'USG-ABDOMEN': { nameBn: 'পেটের আলট্রাসনোগ্রাম', pricePoisha: 150_000 },
  HBA1C: { nameBn: 'HbA1c', pricePoisha: 110_000 },
};

/** The catalogue, for the chips `BTN-B05-TEST` renders. */
export function testCatalogue(): { code: string; nameBn: string; pricePoisha: number }[] {
  return Object.entries(DEMO_TEST_CATALOGUE).map(([code, entry]) => ({
    code,
    nameBn: entry.nameBn,
    pricePoisha: entry.pricePoisha,
  }));
}

function guard(result: { ok: boolean; code?: string; detail?: string }): void {
  if (result.ok) return;
  throw new AppError('TEST_TRANSITION_INVALID', {
    message: result.detail ?? 'That step is not allowed.',
    details: { guard: result.code ?? 'WRONG_STATE' },
  });
}

// ---------------------------------------------------------------------------
// Ordering (`BTN-B05-TEST`, `FR-DOC-06`, `FR-LAB-01`)
// ---------------------------------------------------------------------------

export async function order(
  input: {
    readonly bookingId: string;
    readonly tests: readonly { testCode: string; testName?: string | undefined }[];
    readonly idempotencyKey: string;
  },
  actor: LabActor,
): Promise<{ orders: TestOrderView[]; duplicate: boolean; serverTs: string }> {
  const { orders, duplicate, hospitalId } = await withTransaction(async (trx) => {
    await labRepo.lockIdempotencyKey(trx, input.idempotencyKey);

    // A replay finds every row its original made. The key is stored suffixed
    // by the test code, so four chips ticked in one tap come back as four.
    const replayed = await labRepo.findByIdempotencyKey(trx, input.idempotencyKey);
    if (replayed.length > 0) {
      return { orders: replayed, duplicate: true, hospitalId: replayed[0]?.hospitalId ?? null };
    }

    const visit = await labRepo.visitForBooking(trx, input.bookingId);
    if (visit === null) {
      throw notFound('visit');
    }

    // The route's guard read a token; this reads the row. A doctor scoped to
    // one hospital cannot order a test onto another's bench.
    if (visit.hospitalId !== actor.hospitalId) {
      throw forbiddenScope({ resource: 'visit', hospitalId: visit.hospitalId });
    }

    const created: string[] = [];
    const seen = new Set<string>();

    for (const test of input.tests) {
      const code = test.testCode.toUpperCase();

      // The same chip ticked twice in one request is one order. A doctor who
      // genuinely wants a repeat test orders it at the next visit; two
      // identical rows here would be two samples drawn from one arm.
      if (seen.has(code)) continue;
      seen.add(code);

      const known = DEMO_TEST_CATALOGUE[code];
      const testName = known?.nameBn ?? test.testName;
      if (testName === undefined) {
        throw validationFailed({
          field: 'tests',
          reason: `unknown test code ${code}, and no name was given for it`,
        });
      }

      created.push(
        await labRepo.insertTestOrder(trx, {
          visitId: visit.visitId,
          patientId: visit.patientId,
          hospitalId: visit.hospitalId,
          testCode: code,
          testName,
          pricePoisha: known?.pricePoisha ?? 0,
          orderedBy: actor.staffUserId,
          // Suffixed per test, so each row is unique and a replay finds them all.
          idempotencyKey: `${input.idempotencyKey}:${code}`,
        }),
      );
    }

    const rows: TestOrderView[] = [];
    for (const id of created) {
      const row = await labRepo.findTestOrder(id, trx);
      if (row !== null) rows.push(row);
    }

    return { orders: rows, duplicate: false, hospitalId: visit.hospitalId };
  });

  const serverTs = new Date().toISOString();

  if (!duplicate && orders.length > 0 && hospitalId !== null) {
    emit.testOrdered(hospitalId, { orders }, serverTs);
  }

  return { orders, duplicate, serverTs };
}

// ---------------------------------------------------------------------------
// The state buttons (`S-B-08`, `FR-LAB-02`)
// ---------------------------------------------------------------------------

export async function advance(
  input: { readonly orderId: string; readonly action: LabAction },
  actor: LabActor,
): Promise<LabResult> {
  const at = new Date();

  const { order: updated, duplicate } = await withTransaction(async (trx) => {
    const current = await lockOwn(trx, input.orderId, actor);

    if (labOrderAlreadyApplied(current, input.action)) {
      return { order: current, duplicate: true };
    }

    guard(canActOnTestOrder(current, input.action));

    await labRepo.setTestOrderState(trx, {
      orderId: current.id,
      state: LAB_ACTION_RESULT[input.action],
      at,
    });

    const after = await labRepo.findTestOrder(current.id, trx);
    if (after === null) throw notFound('test order');
    return { order: after, duplicate: false };
  });

  const serverTs = at.toISOString();
  if (!duplicate) emit.testUpdated(updated.hospitalId, { order: updated }, serverTs);

  return { order: updated, duplicate, serverTs };
}

// ---------------------------------------------------------------------------
// The report (`FR-LAB-03`)
// ---------------------------------------------------------------------------

export async function uploadReport(
  input: {
    readonly orderId: string;
    readonly fileType: (typeof REPORT_FILE_TYPES)[number];
    readonly content: string;
    readonly idempotencyKey: string;
  },
  actor: LabActor,
): Promise<LabResult> {
  const at = new Date();

  // Read the order once before storing anything, so an upload against an
  // order that cannot take one never reaches the store at all.
  const before = await labRepo.findTestOrder(input.orderId);
  if (before === null) throw notFound('test order');
  if (before.hospitalId !== actor.hospitalId) {
    throw forbiddenScope({ resource: 'test order', hospitalId: before.hospitalId });
  }

  // **Replay before guard.** A successful upload leaves the order `delivered`,
  // which `canUploadReport` refuses — so a console replaying its outbox would
  // be told its own completed upload was too late. The key is what decides,
  // and answering here also means a replayed ten megabytes is never re-stored.
  const already = await labRepo.findReportByIdempotencyKey(input.idempotencyKey);
  if (already !== null) {
    return { order: before, duplicate: true, serverTs: at.toISOString() };
  }

  guard(canUploadReport(before));

  const bytes = Buffer.from(input.content, 'base64');
  if (bytes.length === 0) {
    throw validationFailed({ field: 'content', reason: 'the file decoded to no bytes' });
  }

  // Stored outside the transaction — see the header. The key is derived from
  // the order and the idempotency key, never from a file name a client sent.
  const key = `reports/${before.id}/${input.idempotencyKey}.${extensionFor(input.fileType)}`;
  let fileUrl: string;
  try {
    const stored = await storage().put({ key, contentType: input.fileType, bytes });
    fileUrl = stored.url;
  } catch (cause) {
    logger.error({ orderId: before.id, err: cause }, 'report upload failed');
    throw new AppError('REPORT_STORAGE_FAILED', { cause });
  }

  const {
    order: updated,
    duplicate,
    batch,
  } = await withTransaction(async (trx) => {
    const current = await lockOwn(trx, input.orderId, actor);

    // Again, inside the lock: two uploads carrying one key that raced the
    // check above serialise here, and the second finds the first's report.
    const replayed = await labRepo.findReportByIdempotencyKey(input.idempotencyKey, trx);
    if (replayed !== null) {
      return { order: current, duplicate: true, batch: null };
    }

    guard(canUploadReport(current));

    const reportId = await labRepo.insertReport(trx, {
      testOrderId: current.id,
      fileUrl,
      fileType: input.fileType,
      uploadedBy: actor.staffUserId,
      idempotencyKey: input.idempotencyKey,
    });

    // The order is ready the moment a report exists, whatever state it was
    // in: an upload *is* the "report ready" tap, and making the lab press
    // both would leave a report nobody had been told about.
    if (current.state !== 'report_ready') {
      await labRepo.setTestOrderState(trx, { orderId: current.id, state: 'report_ready', at });
    }

    // `FR-LAB-03`: to the patient's wallet, and to the doctor who ordered it.
    // A test with no visit behind it has no ordering doctor, so it reaches one
    // recipient and says so rather than naming a doctor who does not exist.
    const recipients = current.visitId === null ? ['patient'] : ['patient', 'doctor'];

    const withReport = await labRepo.findTestOrder(current.id, trx);
    if (withReport === null) throw notFound('test order');
    guard(canDeliverReport(withReport));

    await labRepo.markReportDelivered(trx, { reportId, recipients, at });
    await labRepo.setTestOrderState(trx, { orderId: current.id, state: 'delivered', at });

    const queued = await notifications.queueReportReady(trx, { testOrderId: current.id }, at);

    const after = await labRepo.findTestOrder(current.id, trx);
    if (after === null) throw notFound('test order');
    return { order: after, duplicate: false, batch: queued };
  });

  const serverTs = at.toISOString();

  if (!duplicate) {
    emit.testUpdated(updated.hospitalId, { order: updated }, serverTs);
    if (batch !== null) await notifications.dispatch(batch);
  }

  return { order: updated, duplicate, serverTs };
}

function extensionFor(fileType: string): string {
  switch (fileType) {
    case 'application/pdf':
      return 'pdf';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const STATE_SETS: Readonly<Record<'open' | 'reported' | 'all', readonly TestState[]>> = {
  open: OPEN_TEST_STATES,
  reported: REPORTED_TEST_STATES,
  all: [...OPEN_TEST_STATES, ...REPORTED_TEST_STATES, 'cancelled'],
};

/** The lab queue and its turnaround figures (`S-B-08`, `FR-LAB-01`, `FR-LAB-04`). */
export async function queue(
  input: {
    readonly hospitalId: string;
    readonly state: 'open' | 'reported' | 'all';
    readonly days: number;
  },
  actor: LabActor,
): Promise<{
  orders: TestOrderView[];
  turnaround: TurnaroundSummary[];
  serverTs: string;
}> {
  if (input.hospitalId !== actor.hospitalId) {
    throw forbiddenScope({ resource: 'lab queue', hospitalId: input.hospitalId });
  }

  const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
  const rows = await labRepo.listLabQueue({
    hospitalId: input.hospitalId,
    states: STATE_SETS[input.state],
    since,
  });

  return {
    orders: sortLabQueue(rows),
    // Measured over everything in the window, not just what the filter shows:
    // a median computed from the open list alone would have nothing in it.
    turnaround: summariseTurnaround(
      input.state === 'all'
        ? rows
        : await labRepo.listLabQueue({
            hospitalId: input.hospitalId,
            states: STATE_SETS.all,
            since,
          }),
    ),
    serverTs: new Date().toISOString(),
  };
}

/** The test orders behind one booking — what a tracking link carries. */
export async function ordersForBooking(bookingId: string): Promise<TestOrderView[]> {
  return sortLabQueue(await labRepo.listTestOrdersForBooking(bookingId));
}

/** The name a bench calls somebody by (`S-B-08`). Audited by the caller. */
export async function patientLabel(orderId: string, actor: LabActor): Promise<string | null> {
  const row = await labRepo.findTestOrder(orderId);
  if (row === null) throw notFound('test order');
  if (row.hospitalId !== actor.hospitalId) {
    throw forbiddenScope({ resource: 'test order', hospitalId: row.hospitalId });
  }
  return await labRepo.patientLabel(row.patientId);
}

/**
 * A stored report, behind its signature (`GET /files/:key`).
 *
 * Null for a bad signature, an expired one and a key that was never real —
 * the three are deliberately indistinguishable, for the reason
 * `GUEST_LINK_EXPIRED` gives: telling an unknown caller that a key *exists*
 * is how a guessing attack learns it is getting warmer, and this key names a
 * patient's report.
 */
export async function openSignedFile(input: {
  readonly key: string;
  readonly expires: number;
  readonly signature: string;
}): Promise<{ contentType: string; bytes: Buffer } | null> {
  if (!verifyFileSignature(input.key, input.expires, input.signature).ok) return null;
  return await storage().get(input.key);
}

/**
 * A fresh signed URL for a stored report, or null when there is no such row.
 *
 * Minted per request rather than stored: `reports.file_url` holds the object
 * key's signed URL as it was at upload, and a signature expires. Re-signing
 * here is what keeps a report openable next week without making the key
 * guessable in the meantime.
 */
export async function reportUrl(reportId: string): Promise<string | null> {
  const file = await labRepo.findReportFile(reportId);
  if (file === null) return null;
  return await storage().signedUrl(keyFromUrl(file.fileUrl));
}

/**
 * The object key inside a stored URL.
 *
 * The mock store writes `/files/<encoded key>?…`; a real bucket writes its
 * own shape. Both are re-signed from the key, so this pulls it back out
 * rather than keeping a second column that could disagree with the first.
 */
function keyFromUrl(fileUrl: string): string {
  const path = fileUrl.split('?')[0] ?? fileUrl;
  const marker = '/files/';
  const at = path.indexOf(marker);
  return at === -1 ? path : decodeURIComponent(path.slice(at + marker.length));
}

/** Locks an order and refuses one belonging to another hospital. */
async function lockOwn(trx: Tx, orderId: string, actor: LabActor): Promise<TestOrderView> {
  const current = await labRepo.lockTestOrder(trx, orderId);
  if (current === null) throw notFound('test order');
  if (current.hospitalId !== actor.hospitalId) {
    throw forbiddenScope({ resource: 'test order', hospitalId: current.hospitalId });
  }
  return current;
}
