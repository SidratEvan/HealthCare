/**
 * Test orders, reports and pharmacy stock (DATABASE.md §2.4, §2.8;
 * migrations 0007, 0011, 0018; `FR-LAB-*`, `FR-PHR-02`).
 *
 * The only place lab and pharmacy SQL lives (CLAUDE.md §7). The rules
 * `referral.repo` follows hold here too:
 *
 * **An order is written under a lock the service took.** `lockTestOrder` is
 * `FOR UPDATE OF t`; a lab tapping *report ready* while the delivery worker
 * reads the same row serialise on it, and the second decides against what the
 * first wrote.
 *
 * **A report read never names a patient to a console that has no business
 * with one.** The lab queue carries the order, the test and its timestamps —
 * a patient's name is joined in only for the one console that must call them
 * to a bench, and `patient_label` is what it gets: the name, at the hospital
 * that ordered it, and nothing else about them (`DB-P7`).
 */

import { sql } from 'kysely';

import type { TestOrderView, TestReportView, TestState, Timestamp } from '@platform/domain';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

function iso(value: Date | null): Timestamp | null {
  return value === null ? null : (value.toISOString() as Timestamp);
}

interface TestOrderSqlRow {
  id: string;
  hospital_id: string;
  patient_id: string;
  visit_id: string | null;
  test_code: string;
  test_name: string;
  state: TestState;
  price_poisha: number;
  ordered_at: Date;
  sample_at: Date | null;
  ready_at: Date | null;
  delivered_at: Date | null;
  report_id: string | null;
  report_file_type: string | null;
  report_uploaded_at: Date | null;
  report_delivered_at: Date | null;
}

const ORDER_SELECT = sql`
  SELECT t.id, t.hospital_id, t.patient_id, t.visit_id, t.test_code, t.test_name,
         t.state::text AS state, t.price_poisha,
         t.created_at AS ordered_at, t.sample_at, t.ready_at, t.delivered_at,
         r.id AS report_id, r.file_type AS report_file_type,
         r.created_at AS report_uploaded_at,
         r.delivered_to_wallet_at AS report_delivered_at
    FROM test_orders t
    LEFT JOIN LATERAL (
      SELECT id, file_type, created_at, delivered_to_wallet_at
        FROM reports
       WHERE test_order_id = t.id AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1
    ) r ON true
`;

function toView(row: TestOrderSqlRow): TestOrderView {
  const report: TestReportView | null =
    row.report_id === null
      ? null
      : {
          id: row.report_id,
          fileType: row.report_file_type,
          // A report row always has `created_at`; the null branch is for the
          // type, not for a case that happens.
          uploadedAt: iso(row.report_uploaded_at) ?? (row.ordered_at.toISOString() as Timestamp),
          deliveredToWalletAt: iso(row.report_delivered_at),
        };

  return {
    id: row.id,
    hospitalId: row.hospital_id,
    patientId: row.patient_id,
    visitId: row.visit_id,
    testCode: row.test_code,
    testName: row.test_name,
    state: row.state,
    pricePoisha: row.price_poisha,
    orderedAt: row.ordered_at.toISOString() as Timestamp,
    sampleAt: iso(row.sample_at),
    readyAt: iso(row.ready_at),
    deliveredAt: iso(row.delivered_at),
    report,
  };
}

export async function findTestOrder(orderId: string, trx?: Tx): Promise<TestOrderView | null> {
  const result = await sql<TestOrderSqlRow>`
    ${ORDER_SELECT}
     WHERE t.id = ${orderId}::uuid AND t.deleted_at IS NULL
  `.execute(trx ?? db);
  const row = result.rows[0];
  return row === undefined ? null : toView(row);
}

export async function lockTestOrder(trx: Tx, orderId: string): Promise<TestOrderView | null> {
  const result = await sql<TestOrderSqlRow>`
    ${ORDER_SELECT}
     WHERE t.id = ${orderId}::uuid AND t.deleted_at IS NULL
       FOR UPDATE OF t
  `.execute(trx);
  const row = result.rows[0];
  return row === undefined ? null : toView(row);
}

/**
 * The lab queue for one hospital (`S-B-08`, `FR-LAB-01`).
 *
 * Ordering is left to `sortLabQueue` in the domain rather than done here: the
 * console applies state buttons optimistically and re-sorts locally, and two
 * sort orders that could drift is the arrangement CLAUDE.md §7 forbids for the
 * queue reducer, for the same reason.
 */
export async function listLabQueue(input: {
  readonly hospitalId: string;
  readonly states: readonly TestState[];
  readonly since: Date;
}): Promise<TestOrderView[]> {
  const result = await sql<TestOrderSqlRow>`
    ${ORDER_SELECT}
     WHERE t.hospital_id = ${input.hospitalId}::uuid
       AND t.deleted_at IS NULL
       AND t.state = ANY(${input.states}::test_state[])
       AND t.created_at >= ${input.since}
     ORDER BY t.created_at DESC
     LIMIT 500
  `.execute(db);
  return result.rows.map(toView);
}

/** Every order of one patient — the wallet's Reports tab (`TAB-A12-REP`). */
export async function listPatientTestOrders(patientId: string): Promise<TestOrderView[]> {
  const result = await sql<TestOrderSqlRow>`
    ${ORDER_SELECT}
     WHERE t.patient_id = ${patientId}::uuid
       AND t.deleted_at IS NULL
     ORDER BY t.created_at DESC
     LIMIT 200
  `.execute(db);
  return result.rows.map(toView);
}

/**
 * The orders of one booking's visit — what a tracking link carries
 * (`FR-GST-08`: records created for a guest are downloadable from the link).
 *
 * Keyed on the booking rather than the patient for the reason
 * `guest.service` gives: a link is scoped to one booking, and an SMS that gets
 * forwarded to relatives must not carry everything the person was ever seen
 * for.
 */
export async function listTestOrdersForBooking(bookingId: string): Promise<TestOrderView[]> {
  const result = await sql<TestOrderSqlRow>`
    ${ORDER_SELECT}
     JOIN visits v ON v.id = t.visit_id
     WHERE v.booking_id = ${bookingId}::uuid
       AND v.deleted_at IS NULL
       AND t.deleted_at IS NULL
     ORDER BY t.created_at DESC
  `.execute(db);
  return result.rows.map(toView);
}

/** The name a bench calls somebody by. One console reads it (`DB-P7`). */
export async function patientLabel(patientId: string): Promise<string | null> {
  const result = await sql<{ full_name: string }>`
    SELECT full_name FROM patients WHERE id = ${patientId}::uuid AND deleted_at IS NULL
  `.execute(db);
  return result.rows[0]?.full_name ?? null;
}

/**
 * Serialises two orders carrying the same key for the rest of the
 * transaction, so a replay that races its original waits and then finds the
 * orders rather than making a second set.
 */
export async function lockIdempotencyKey(trx: Tx, key: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`lab-key:${key}`}, 0))`.execute(trx);
}

/** The orders a replayed request already made. Empty when it is not a replay. */
export async function findByIdempotencyKey(trx: Tx, keyPrefix: string): Promise<TestOrderView[]> {
  const result = await sql<TestOrderSqlRow>`
    ${ORDER_SELECT}
     WHERE t.idempotency_key LIKE ${`${keyPrefix}:%`}
     ORDER BY t.created_at ASC
  `.execute(trx);
  return result.rows.map(toView);
}

/** The visit and hospital a booking's consultation belongs to. */
export async function visitForBooking(
  trx: Tx,
  bookingId: string,
): Promise<{ visitId: string; patientId: string; hospitalId: string; doctorId: string } | null> {
  const result = await sql<{
    id: string;
    patient_id: string;
    hospital_id: string;
    doctor_id: string;
  }>`
    SELECT id, patient_id, hospital_id, doctor_id
      FROM visits
     WHERE booking_id = ${bookingId}::uuid AND deleted_at IS NULL
  `.execute(trx);

  const row = result.rows[0];
  return row === undefined
    ? null
    : {
        visitId: row.id,
        patientId: row.patient_id,
        hospitalId: row.hospital_id,
        doctorId: row.doctor_id,
      };
}

/** `POST /test-orders` — one row per test ticked (`FR-DOC-06`, `FR-LAB-01`). */
export async function insertTestOrder(
  trx: Tx,
  input: {
    readonly visitId: string;
    readonly patientId: string;
    readonly hospitalId: string;
    readonly testCode: string;
    readonly testName: string;
    readonly pricePoisha: number;
    readonly orderedBy: string | null;
    readonly idempotencyKey: string | null;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO test_orders
      (visit_id, patient_id, hospital_id, test_code, test_name,
       price_poisha, ordered_by, created_by, idempotency_key)
    VALUES (
      ${input.visitId}::uuid, ${input.patientId}::uuid, ${input.hospitalId}::uuid,
      ${input.testCode}, ${input.testName}, ${input.pricePoisha},
      ${input.orderedBy}::uuid, ${input.orderedBy}::uuid, ${input.idempotencyKey}
    )
    RETURNING id
  `.execute(trx);

  const row = result.rows[0];
  if (row === undefined) throw new Error('insertTestOrder returned no row');
  return row.id;
}

/**
 * Moves an order to its next state, stamping the time that state is measured
 * from (`FR-LAB-02`, `FR-LAB-04`).
 *
 * The stamps are written once and never overwritten: `COALESCE` keeps the
 * first, so a replayed action cannot move a turnaround measurement.
 */
export async function setTestOrderState(
  trx: Tx,
  input: {
    readonly orderId: string;
    readonly state: TestState;
    readonly at: Date;
  },
): Promise<void> {
  await sql`
    UPDATE test_orders
       SET state = ${input.state}::test_state,
           sample_at = CASE WHEN ${input.state}::test_state = 'sample_collected'
                            THEN COALESCE(sample_at, ${input.at}) ELSE sample_at END,
           ready_at  = CASE WHEN ${input.state}::test_state = 'report_ready'
                            THEN COALESCE(ready_at, ${input.at}) ELSE ready_at END,
           delivered_at = CASE WHEN ${input.state}::test_state = 'delivered'
                               THEN COALESCE(delivered_at, ${input.at}) ELSE delivered_at END
     WHERE id = ${input.orderId}::uuid
  `.execute(trx);
}

/** `POST /test-orders/:id/report` — the uploaded file's row (`FR-LAB-03`). */
export async function insertReport(
  trx: Tx,
  input: {
    readonly testOrderId: string;
    readonly fileUrl: string;
    readonly fileType: string;
    readonly uploadedBy: string | null;
    readonly idempotencyKey: string | null;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO reports (test_order_id, file_url, file_type, uploaded_by, idempotency_key)
    VALUES (
      ${input.testOrderId}::uuid, ${input.fileUrl}, ${input.fileType},
      ${input.uploadedBy}::uuid, ${input.idempotencyKey}
    )
    RETURNING id
  `.execute(trx);

  const row = result.rows[0];
  if (row === undefined) throw new Error('insertReport returned no row');
  return row.id;
}

/** The report a replayed upload already made. */
export async function findReportByIdempotencyKey(
  key: string,
  trx?: Tx,
): Promise<{ id: string; fileUrl: string } | null> {
  const result = await sql<{ id: string; file_url: string }>`
    SELECT id, file_url FROM reports WHERE idempotency_key = ${key}
  `.execute(trx ?? db);
  const row = result.rows[0];
  return row === undefined ? null : { id: row.id, fileUrl: row.file_url };
}

/**
 * Records that a report reached the people `FR-LAB-03` names.
 *
 * `delivered_to` and the stamp are written together, because the schema
 * refuses a stamp with an empty recipient list — the constraint exists so the
 * figure the promise is measured by cannot be set without saying to whom.
 */
export async function markReportDelivered(
  trx: Tx,
  input: {
    readonly reportId: string;
    readonly recipients: readonly string[];
    readonly at: Date;
  },
): Promise<void> {
  await sql`
    UPDATE reports
       SET delivered_to_wallet_at = COALESCE(delivered_to_wallet_at, ${input.at}),
           delivered_to = ${input.recipients}::text[]
     WHERE id = ${input.reportId}::uuid
  `.execute(trx);
}

/** The stored object behind a report, for the route that serves a signed URL. */
export async function findReportFile(
  reportId: string,
): Promise<{ fileUrl: string; fileType: string | null; patientId: string } | null> {
  const result = await sql<{ file_url: string; file_type: string | null; patient_id: string }>`
    SELECT r.file_url, r.file_type, t.patient_id
      FROM reports r
      JOIN test_orders t ON t.id = r.test_order_id
     WHERE r.id = ${reportId}::uuid AND r.deleted_at IS NULL
  `.execute(db);
  const row = result.rows[0];
  return row === undefined
    ? null
    : { fileUrl: row.file_url, fileType: row.file_type, patientId: row.patient_id };
}

/**
 * Reports that have not reached a wallet (`FR-LAB-03`'s own measurement).
 *
 * The null count is the promise's scoreboard — `reports_undelivered_idx`
 * exists for this query and `reports.delivered_to_wallet_at`'s comment says
 * why. Nothing polls it in this version; delivery happens in the upload's own
 * transaction. It is here for the retry a worker will do when `pg-boss` lands.
 */
export async function countUndeliveredReports(hospitalId: string): Promise<number> {
  const result = await sql<{ count: string }>`
    SELECT count(*)::text AS count
      FROM reports r
      JOIN test_orders t ON t.id = r.test_order_id
     WHERE t.hospital_id = ${hospitalId}::uuid
       AND r.delivered_to_wallet_at IS NULL
       AND r.deleted_at IS NULL
  `.execute(db);
  return Number(result.rows[0]?.count ?? '0');
}

// ---------------------------------------------------------------------------
// Pharmacy stock (`FR-PHR-02`, migration 0011)
// ---------------------------------------------------------------------------

interface StockSqlRow {
  medicine_id: string;
  generic_name: string;
  brand_name: string | null;
  form: string | null;
  strengths: string[] | null;
  in_stock: boolean;
  updated_at: Date;
}

/** One pharmacy's shelf, oldest flag first — what needs checking (`S-B-09`). */
export async function listStock(hospitalId: string): Promise<
  {
    medicineId: string;
    genericName: string;
    brandName: string | null;
    form: string | null;
    strengths: readonly string[];
    inStock: boolean;
    updatedAt: Timestamp;
  }[]
> {
  const result = await sql<StockSqlRow>`
    SELECT s.medicine_id, m.generic_name, m.brand_name, m.form, m.strengths,
           s.in_stock, s.updated_at
      FROM pharmacy_stock s
      JOIN medicines m ON m.id = s.medicine_id
     WHERE s.hospital_id = ${hospitalId}::uuid
       AND s.deleted_at IS NULL
       AND m.deleted_at IS NULL
     ORDER BY s.updated_at ASC, m.generic_name ASC
  `.execute(db);

  return result.rows.map((row) => ({
    medicineId: row.medicine_id,
    genericName: row.generic_name,
    brandName: row.brand_name,
    form: row.form,
    strengths: row.strengths ?? [],
    inStock: row.in_stock,
    updatedAt: row.updated_at.toISOString() as Timestamp,
  }));
}

/**
 * Writes the flags a pharmacy confirmed (`FR-PHR-02`).
 *
 * An upsert that always touches `updated_at`, including where the boolean did
 * not change: re-sending an unchanged flag is how somebody says "still true",
 * and the freshness a patient sees is what that renews. `DO UPDATE` with an
 * unchanged value would not fire the touch trigger on its own, so the column
 * is set explicitly.
 */
export async function upsertStockFlags(
  trx: Tx,
  input: {
    readonly hospitalId: string;
    readonly flags: readonly { medicineId: string; inStock: boolean }[];
    readonly at: Date;
    readonly staffUserId: string | null;
  },
): Promise<number> {
  const medicineIds = input.flags.map((flag) => flag.medicineId);
  const values = input.flags.map((flag) => flag.inStock);

  const result = await sql<{ medicine_id: string }>`
    INSERT INTO pharmacy_stock (hospital_id, medicine_id, in_stock, created_by, updated_at)
    SELECT ${input.hospitalId}::uuid, m.id, f.in_stock, ${input.staffUserId}::uuid, ${input.at}
      FROM unnest(${medicineIds}::uuid[], ${values}::boolean[]) AS f(medicine_id, in_stock)
      JOIN medicines m ON m.id = f.medicine_id AND m.deleted_at IS NULL
    ON CONFLICT (hospital_id, medicine_id) WHERE deleted_at IS NULL
    DO UPDATE SET in_stock = EXCLUDED.in_stock, updated_at = ${input.at}
    RETURNING medicine_id
  `.execute(trx);

  return result.rows.length;
}

interface AvailabilitySqlRow {
  hospital_id: string;
  name_bn: string;
  name_en: string;
  medicine_id: string;
  generic_name: string;
  brand_name: string | null;
  form: string | null;
  in_stock: boolean | null;
  updated_at: Date | null;
  distance_m: number | null;
}

/**
 * `GET /medicines?q=` — who near here has this medicine (`FR-PHR-02`).
 *
 * A LEFT JOIN, deliberately: a pharmacy that has never flagged this medicine
 * comes back with nulls and becomes *unknown*, rather than being absent. An
 * absent hospital reads as "does not stock it", which is a claim nobody made
 * (`PRD.md` §3.2). `stockAnswerFor` in the domain turns the nulls into the
 * third answer.
 */
export async function searchMedicineAvailability(input: {
  readonly query: string;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly limit: number;
}): Promise<
  {
    hospitalId: string;
    hospitalNameBn: string;
    hospitalNameEn: string;
    medicineId: string;
    genericName: string;
    brandName: string | null;
    form: string | null;
    inStock: boolean | null;
    updatedAt: Timestamp | null;
    distanceKm: number | null;
  }[]
> {
  const pattern = `%${input.query.toLowerCase()}%`;

  const result = await sql<AvailabilitySqlRow>`
    WITH matched AS (
      SELECT id, generic_name, brand_name, form
        FROM medicines
       WHERE deleted_at IS NULL
         AND (lower(generic_name) LIKE ${pattern} OR lower(brand_name) LIKE ${pattern})
       ORDER BY lower(generic_name)
       LIMIT 10
    )
    SELECT h.id AS hospital_id, h.name_bn, h.name_en,
           m.id AS medicine_id, m.generic_name, m.brand_name, m.form,
           s.in_stock, s.updated_at,
           CASE WHEN ${input.lat}::double precision IS NULL OR h.geo IS NULL THEN NULL
                ELSE ST_Distance(
                       h.geo,
                       ST_SetSRID(ST_MakePoint(${input.lng ?? 0}, ${input.lat ?? 0}), 4326)::geography
                     )
           END AS distance_m
      FROM matched m
      CROSS JOIN hospitals h
      LEFT JOIN pharmacy_stock s
             ON s.hospital_id = h.id AND s.medicine_id = m.id AND s.deleted_at IS NULL
     WHERE h.deleted_at IS NULL
       AND h.is_live
       -- Only facilities that keep a shelf at all. A hospital with no
       -- pharmacy is not "unknown" about a medicine; it is not a pharmacy.
       AND EXISTS (
         SELECT 1 FROM pharmacy_stock ps
          WHERE ps.hospital_id = h.id AND ps.deleted_at IS NULL
       )
     ORDER BY m.generic_name, distance_m NULLS LAST, h.name_en
     LIMIT ${input.limit}
  `.execute(db);

  return result.rows.map((row) => ({
    hospitalId: row.hospital_id,
    hospitalNameBn: row.name_bn,
    hospitalNameEn: row.name_en,
    medicineId: row.medicine_id,
    genericName: row.generic_name,
    brandName: row.brand_name,
    form: row.form,
    inStock: row.in_stock,
    updatedAt: row.updated_at === null ? null : (row.updated_at.toISOString() as Timestamp),
    distanceKm: row.distance_m === null ? null : Math.round(row.distance_m / 100) / 10,
  }));
}
