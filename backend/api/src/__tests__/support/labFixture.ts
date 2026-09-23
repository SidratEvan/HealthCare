/**
 * Fixtures for the lab and pharmacy suites (`FR-LAB-*`, `FR-PHR-02`).
 *
 * Everything here reads the seeded demo database (CLAUDE.md §6: tests run
 * against the seeds, never against fixtures scattered in test files). What it
 * *writes* is the one thing the seeds cannot hold — a consultation signed
 * moments ago, so an order made against it is this test's and not a row the
 * seed happened to leave in that state.
 */

import { sql } from 'kysely';

import { db } from '../../config/db.js';

import { staffTokenFor } from './emergencyFixture.js';

export interface LabFixture {
  readonly hospitalId: string;
  readonly labStaffId: string;
  readonly labToken: string;
  readonly doctorToken: string;
  readonly pharmacyToken: string;
  readonly adminToken: string;
  readonly wardToken: string;
}

export async function seededHospitalId(nameEnPrefix: string): Promise<string> {
  const result = await sql<{ id: string }>`
    SELECT id FROM hospitals WHERE name_en LIKE ${`${nameEnPrefix}%`} AND deleted_at IS NULL LIMIT 1
  `.execute(db);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error(`The seed should hold ${nameEnPrefix} (FR-DEM-01).`);
  return id;
}

async function staffIdFor(hospitalId: string, role: string): Promise<string> {
  const result = await sql<{ staff_user_id: string }>`
    SELECT staff_user_id FROM staff_roles
     WHERE hospital_id = ${hospitalId}::uuid AND role = ${role}::staff_role
       AND deleted_at IS NULL
     ORDER BY created_at, staff_user_id
     LIMIT 1
  `.execute(db);
  const id = result.rows[0]?.staff_user_id;
  if (id === undefined) {
    throw new Error(`The seeded roster should give ${role} to this hospital (FR-ROLE-01).`);
  }
  return id;
}

export async function labFixture(nameEnPrefix: string): Promise<LabFixture> {
  const hospitalId = await seededHospitalId(nameEnPrefix);
  const labStaffId = await staffIdFor(hospitalId, 'lab');

  return {
    hospitalId,
    labStaffId,
    labToken: await staffTokenFor(labStaffId, hospitalId, 'lab'),
    doctorToken: await staffTokenFor(await staffIdFor(hospitalId, 'doctor'), hospitalId, 'doctor'),
    pharmacyToken: await staffTokenFor(
      await staffIdFor(hospitalId, 'pharmacy'),
      hospitalId,
      'pharmacy',
    ),
    adminToken: await staffTokenFor(
      await staffIdFor(hospitalId, 'hospital_admin'),
      hospitalId,
      'hospital_admin',
    ),
    wardToken: await staffTokenFor(await staffIdFor(hospitalId, 'ward'), hospitalId, 'ward'),
  };
}

/**
 * A consultation signed a moment ago, at this hospital, with a booking behind
 * it — what `POST /test-orders` needs.
 *
 * The booking and the patient come from the seeds; only the visit is new. A
 * seeded visit would do for most assertions, but an order's idempotency and
 * its broadcast are about *this* request, and reusing a row another test may
 * have ordered against makes a shared database decide the result.
 */
export async function freshVisit(
  hospitalId: string,
): Promise<{ visitId: string; bookingId: string; patientId: string }> {
  const booking = await sql<{ id: string; patient_id: string; doctor_id: string }>`
    SELECT b.id, b.patient_id, s.doctor_id
      FROM bookings b
      JOIN sessions s ON s.id = b.session_id
     WHERE s.hospital_id = ${hospitalId}::uuid
       AND b.patient_id IS NOT NULL
       AND b.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.booking_id = b.id)
     ORDER BY b.created_at DESC
     LIMIT 1
  `.execute(db);

  const row = booking.rows[0];
  if (row === undefined) {
    throw new Error('The seed should hold a booking with no visit yet (FR-DEM-03).');
  }

  const staffId = await staffIdFor(hospitalId, 'doctor');

  const visit = await sql<{ id: string }>`
    INSERT INTO visits
      (booking_id, patient_id, hospital_id, doctor_id, diagnosis_text, signed_at, created_by)
    VALUES (
      ${row.id}::uuid, ${row.patient_id}::uuid, ${hospitalId}::uuid, ${row.doctor_id}::uuid,
      'পরীক্ষার জন্য', now(), ${staffId}::uuid
    )
    RETURNING id
  `.execute(db);

  const visitId = visit.rows[0]?.id;
  if (visitId === undefined) throw new Error('freshVisit wrote no row.');

  return { visitId, bookingId: row.id, patientId: row.patient_id };
}

/** A seeded order in a given state at this hospital, for the state machine. */
export async function seededOrder(
  hospitalId: string,
  state: string,
): Promise<{ id: string; state: string } | null> {
  const result = await sql<{ id: string; state: string }>`
    SELECT id, state::text AS state FROM test_orders
     WHERE hospital_id = ${hospitalId}::uuid AND state = ${state}::test_state
       AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1
  `.execute(db);
  return result.rows[0] ?? null;
}

/** The row as the database has it, for assertions the API does not return. */
export async function orderRow(orderId: string): Promise<{
  state: string;
  sampleAt: Date | null;
  readyAt: Date | null;
  deliveredAt: Date | null;
  idempotencyKey: string | null;
}> {
  const result = await sql<{
    state: string;
    sample_at: Date | null;
    ready_at: Date | null;
    delivered_at: Date | null;
    idempotency_key: string | null;
  }>`
    SELECT state::text AS state, sample_at, ready_at, delivered_at, idempotency_key
      FROM test_orders WHERE id = ${orderId}::uuid
  `.execute(db);

  const row = result.rows[0];
  if (row === undefined) throw new Error(`No test order ${orderId}.`);
  return {
    state: row.state,
    sampleAt: row.sample_at,
    readyAt: row.ready_at,
    deliveredAt: row.delivered_at,
    idempotencyKey: row.idempotency_key,
  };
}

/** The report rows behind an order, newest first. */
export async function reportsOf(orderId: string): Promise<
  {
    id: string;
    fileUrl: string;
    deliveredAt: Date | null;
    deliveredTo: string[];
  }[]
> {
  const result = await sql<{
    id: string;
    file_url: string;
    delivered_to_wallet_at: Date | null;
    delivered_to: string[];
  }>`
    SELECT id, file_url, delivered_to_wallet_at, delivered_to
      FROM reports WHERE test_order_id = ${orderId}::uuid AND deleted_at IS NULL
     ORDER BY created_at DESC
  `.execute(db);

  return result.rows.map((row) => ({
    id: row.id,
    fileUrl: row.file_url,
    deliveredAt: row.delivered_to_wallet_at,
    deliveredTo: row.delivered_to,
  }));
}

/** A tiny valid PDF, base64, for an upload that has to carry real bytes. */
export const TINY_PDF_BASE64 = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
  'latin1',
).toString('base64');

/** A medicine this hospital's shelf carries, for the stock endpoints. */
export async function stockedMedicine(
  hospitalId: string,
): Promise<{ medicineId: string; genericName: string; inStock: boolean }> {
  const result = await sql<{ medicine_id: string; generic_name: string; in_stock: boolean }>`
    SELECT s.medicine_id, m.generic_name, s.in_stock
      FROM pharmacy_stock s
      JOIN medicines m ON m.id = s.medicine_id
     WHERE s.hospital_id = ${hospitalId}::uuid AND s.deleted_at IS NULL
     ORDER BY m.generic_name
     LIMIT 1
  `.execute(db);

  const row = result.rows[0];
  if (row === undefined) throw new Error('The seed should stock this pharmacy (FR-DEM-05).');
  return { medicineId: row.medicine_id, genericName: row.generic_name, inStock: row.in_stock };
}
