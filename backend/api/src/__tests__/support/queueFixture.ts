/**
 * A session to drive, built from the seeded demo data.
 *
 * The suite's global setup seeds the whole demo database and commits it
 * (CLAUDE.md §6), so these tests run against the same hospitals, doctors and
 * patients a developer sees in Supabase — not against rows invented in a test
 * file.
 *
 * What each test needs on top of that is a session *of its own*. Appending to
 * the shared pitch session would make every test depend on the order the
 * others ran in, and `queue_events` cannot be cleaned up afterwards: it is
 * append-only by design (`DB-P1`), so a test that dirties a session dirties it
 * permanently. A fresh session per test costs two inserts and removes the
 * whole class of problem.
 */

import { sql } from 'kysely';

import { db } from '../../config/db.js';

/** The session a test drives, and the seeded rows it was built from. */
export interface QueueFixture {
  readonly sessionId: string;
  readonly hospitalId: string;
  readonly doctorId: string;
  readonly departmentId: string;
  readonly feePoisha: number;
  /** Booking ids in serial order, 1…n. */
  readonly bookingIds: readonly string[];
  /** Patient ids in the same order. */
  readonly patientIds: readonly string[];
  /** A seeded patient with no booking in this session, for walk-in tests. */
  readonly sparePatientId: string;
  /**
   * A real receptionist at this hospital.
   *
   * `queue_events.actor_staff_id` is a foreign key, so an event can only ever
   * be attributed to somebody who exists (`FR-QUE-04`). A token minted for an
   * invented id is refused by the database, which is the right behaviour and
   * the reason this field is here rather than a constant in a test file.
   */
  readonly receptionistId: string;
  /** A doctor account at the same hospital, for the role matrix. */
  readonly doctorStaffId: string;
}

interface ChamberRow {
  hospital_id: string;
  doctor_id: string;
  department_id: string;
  fee_poisha: number;
}

/**
 * Creates a scheduled session with `bookings` patients on serials 1…n.
 *
 * The chamber is a real seeded one, so the doctor has a configured
 * consultation rate and the fee is the fee that doctor actually charges — both
 * of which the ETA maths reads.
 */
export async function createQueueFixture(bookings = 4): Promise<QueueFixture> {
  const chamber = await sql<ChamberRow>`
    SELECT dh.hospital_id, dh.doctor_id, dh.department_id, dh.fee_poisha
      FROM doctor_hospitals dh
      JOIN doctors d ON d.id = dh.doctor_id
     WHERE dh.deleted_at IS NULL AND dh.is_active
     ORDER BY d.bmdc_number
     LIMIT 1
  `.execute(db);

  const row = chamber.rows[0];
  if (row === undefined) {
    throw new Error('No seeded chamber found. Has the global setup seeded the database?');
  }

  const session = await sql<{ id: string }>`
    INSERT INTO sessions
      (hospital_id, doctor_id, department_id, room, session_date,
       planned_start, planned_end, capacity, fee_poisha)
    VALUES (
      ${row.hospital_id}, ${row.doctor_id}, ${row.department_id}, 'TEST',
      current_date, now() - interval '30 minutes', now() + interval '150 minutes',
      40, ${row.fee_poisha}
    )
    RETURNING id
  `.execute(db);

  const sessionId = session.rows[0]?.id;
  if (sessionId === undefined) throw new Error('session insert returned no id.');

  // Distinct seeded patients: `bookings_one_live_per_patient_per_session` is a
  // unique index, and a session holding one person twice is not a state worth
  // testing against.
  const patients = await sql<{ id: string }>`
    SELECT id FROM patients WHERE deleted_at IS NULL ORDER BY created_at, id LIMIT ${bookings + 1}
  `.execute(db);

  if (patients.rows.length < bookings + 1) {
    throw new Error(
      `Need ${String(bookings + 1)} seeded patients, found ${String(patients.rows.length)}.`,
    );
  }

  const patientIds = patients.rows.slice(0, bookings).map((patient) => patient.id);
  const sparePatientId = patients.rows[bookings]?.id;
  if (sparePatientId === undefined) throw new Error('no spare patient');

  const bookingIds: string[] = [];
  for (const [index, patientId] of patientIds.entries()) {
    const inserted = await sql<{ id: string }>`
      INSERT INTO bookings (session_id, patient_id, serial_number, source, fee_poisha, intake)
      VALUES (${sessionId}, ${patientId}, ${index + 1}, 'app', ${row.fee_poisha}, '{"demo":true}'::jsonb)
      RETURNING id
    `.execute(db);
    const bookingId = inserted.rows[0]?.id;
    if (bookingId === undefined) throw new Error('booking insert returned no id.');
    bookingIds.push(bookingId);
  }

  return {
    sessionId,
    hospitalId: row.hospital_id,
    doctorId: row.doctor_id,
    departmentId: row.department_id,
    feePoisha: row.fee_poisha,
    bookingIds,
    patientIds,
    sparePatientId,
    receptionistId: await staffIdFor(row.hospital_id, 'receptionist'),
    doctorStaffId: await staffIdFor(row.hospital_id, 'doctor'),
  };
}

/** A seeded staff member holding `role` at this hospital. */
export async function staffIdFor(hospitalId: string, role: string): Promise<string> {
  const result = await sql<{ staff_user_id: string }>`
    SELECT staff_user_id
      FROM staff_roles
     WHERE hospital_id = ${hospitalId} AND role = ${role}::staff_role AND deleted_at IS NULL
     ORDER BY created_at, staff_user_id
     LIMIT 1
  `.execute(db);

  const id = result.rows[0]?.staff_user_id;
  if (id === undefined) {
    throw new Error(`The seed should give every facility a ${role}; none found.`);
  }
  return id;
}

/** A hospital other than the fixture's, for the cross-hospital scope tests. */
export async function otherHospitalId(notThisOne: string): Promise<string> {
  const result = await sql<{ id: string }>`
    SELECT id FROM hospitals WHERE id <> ${notThisOne} AND deleted_at IS NULL LIMIT 1
  `.execute(db);

  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('The seed should hold more than one facility.');
  return id;
}

/** Every event type recorded for a session, in log order. */
export async function eventTypesOf(sessionId: string): Promise<string[]> {
  const result = await sql<{ type: string }>`
    SELECT type FROM queue_events WHERE session_id = ${sessionId} ORDER BY seq
  `.execute(db);
  return result.rows.map((row) => row.type);
}

/** The cached projection, to prove the derived rows were written. */
export async function cachedStateOf(sessionId: string): Promise<{
  now_serving_serial: number | null;
  waiting_count: number;
  done_count: number;
  late_count: number;
  no_show_count: number;
  rebuilt_from_seq: string;
} | null> {
  const result = await sql<{
    now_serving_serial: number | null;
    waiting_count: number;
    done_count: number;
    late_count: number;
    no_show_count: number;
    rebuilt_from_seq: string;
  }>`
    SELECT now_serving_serial, waiting_count, done_count, late_count,
           no_show_count, rebuilt_from_seq
      FROM queue_state WHERE session_id = ${sessionId}
  `.execute(db);

  return result.rows[0] ?? null;
}

/** One booking's derived status, to prove the projection reached it. */
export async function bookingStatusOf(bookingId: string): Promise<string | null> {
  const result = await sql<{ status: string }>`
    SELECT status FROM bookings WHERE id = ${bookingId}
  `.execute(db);
  return result.rows[0]?.status ?? null;
}
