/**
 * The smallest row graph the schema tests need: one facility, one department,
 * one doctor sitting there, one scheduled session, one patient, one booking on
 * serial 1. Tests that need a session in progress set `actual_start` and move
 * the status to `running` themselves, because that transition is a constraint
 * worth exercising rather than assuming (`sessions_running_has_started`).
 *
 * CLAUDE.md §6 requires tests to run against seeded demo data rather than
 * fixtures scattered through test files. The seeds arrive in step 5
 * (`feat/seed-demo`); until they exist this module is the single definition
 * these tests share — one place, not scattered — and step 5 replaces its body
 * with a call into `db/seeds` so there is exactly one description of demo data
 * in the repository.
 *
 * Every value is visibly demonstration data (FR-DEM-07) and no row here
 * resembles a real facility, doctor or patient (FR-SEC-08).
 */

import type { Client } from 'pg';

export interface Graph {
  readonly hospitalId: string;
  readonly departmentId: string;
  readonly doctorId: string;
  readonly doctorHospitalId: string;
  readonly staffUserId: string;
  readonly userId: string;
  readonly patientId: string;
  readonly sessionId: string;
  readonly bookingId: string;
}

/** A phone number in the reserved test range, normalised per DB-P6. */
export function testPhone(suffix: number): string {
  return `+88017${String(suffix).padStart(8, '0')}`;
}

export async function insertGraph(client: Client, seed = 1): Promise<Graph> {
  const hospitalId = await insertHospital(client, seed);
  const staffUserId = await insertStaffUser(client, hospitalId, seed);
  const departmentId = await insertDepartment(client, hospitalId, seed);
  const doctorId = await insertDoctor(client, seed);
  const doctorHospitalId = await insertDoctorHospital(
    client,
    doctorId,
    hospitalId,
    departmentId,
    seed,
  );
  const userId = await insertUser(client, seed);
  const patientId = await insertPatient(client, userId, seed);
  const sessionId = await insertSession(client, hospitalId, doctorId, departmentId);
  const bookingId = await insertBooking(client, sessionId, patientId, userId, 1);

  return {
    hospitalId,
    departmentId,
    doctorId,
    doctorHospitalId,
    staffUserId,
    userId,
    patientId,
    sessionId,
    bookingId,
  };
}

async function insertHospital(client: Client, seed: number): Promise<string> {
  return await one(
    client,
    `INSERT INTO hospitals
       (name_bn, name_en, kind, division, district, thana, lat, lng, is_live, onboarded_at)
     VALUES ($1, $2, 'hospital', 'Dhaka', 'Dhaka', 'Demo Thana', 23.7806, 90.4074, true, now())
     RETURNING id`,
    [`ডেমো হাসপাতাল ${String(seed)}`, `Demo Hospital ${String(seed)}`],
  );
}

async function insertStaffUser(client: Client, hospitalId: string, seed: number): Promise<string> {
  return await one(
    client,
    `INSERT INTO staff_users (hospital_id, email, full_name, password_hash)
     VALUES ($1, $2, 'Demo Receptionist', 'argon2id$demo-not-a-real-hash')
     RETURNING id`,
    [hospitalId, `reception${String(seed)}@demo.invalid`],
  );
}

async function insertDepartment(client: Client, hospitalId: string, seed: number): Promise<string> {
  return await one(
    client,
    `INSERT INTO departments (hospital_id, name_bn, name_en, code)
     VALUES ($1, 'কার্ডিওলজি', 'Cardiology', $2)
     RETURNING id`,
    [hospitalId, `CARD${String(seed)}`],
  );
}

async function insertDoctor(client: Client, seed: number): Promise<string> {
  return await one(
    client,
    `INSERT INTO doctors
       (full_name_bn, full_name_en, bmdc_number, bmdc_verified_at, specialties, default_consult_minutes)
     VALUES ('ডেমো ডাক্তার', 'Demo Doctor', $1, now(), ARRAY['cardiology'], 8)
     RETURNING id`,
    [`DEMO-BMDC-${String(seed).padStart(5, '0')}`],
  );
}

async function insertDoctorHospital(
  client: Client,
  doctorId: string,
  hospitalId: string,
  departmentId: string,
  seed: number,
): Promise<string> {
  return await one(
    client,
    `INSERT INTO doctor_hospitals (doctor_id, hospital_id, department_id, fee_poisha, room)
     VALUES ($1, $2, $3, 80000, $4)
     RETURNING id`,
    [doctorId, hospitalId, departmentId, `Room ${String(seed)}`],
  );
}

async function insertUser(client: Client, seed: number): Promise<string> {
  return await one(
    client,
    `INSERT INTO users (phone, phone_verified_at) VALUES ($1, now()) RETURNING id`,
    [testPhone(seed)],
  );
}

async function insertPatient(client: Client, userId: string, seed: number): Promise<string> {
  return await one(
    client,
    `INSERT INTO patients (owner_user_id, full_name, age_years, sex, phone, is_primary)
     VALUES ($1, 'ডেমো রোগী', 62, 'female', $2, true)
     RETURNING id`,
    [userId, testPhone(seed)],
  );
}

async function insertSession(
  client: Client,
  hospitalId: string,
  doctorId: string,
  departmentId: string,
): Promise<string> {
  return await one(
    client,
    `INSERT INTO sessions
       (hospital_id, doctor_id, department_id, room, session_date,
        planned_start, planned_end, status, capacity, fee_poisha)
     VALUES ($1, $2, $3, 'Room 1', current_date,
             now(), now() + interval '3 hours', 'scheduled', 40, 80000)
     RETURNING id`,
    [hospitalId, doctorId, departmentId],
  );
}

export async function insertBooking(
  client: Client,
  sessionId: string,
  patientId: string,
  userId: string | null,
  serial: number,
): Promise<string> {
  return await one(
    client,
    `INSERT INTO bookings
       (session_id, patient_id, booked_by_user_id, serial_number, status, source, fee_poisha)
     VALUES ($1, $2, $3, $4, 'booked', 'app', 80000)
     RETURNING id`,
    [sessionId, patientId, userId, serial],
  );
}

/** Inserts a second patient owned by the same user, for multi-profile cases. */
export async function insertExtraPatient(
  client: Client,
  userId: string,
  name = 'ডেমো রোগী ২',
): Promise<string> {
  return await one(
    client,
    `INSERT INTO patients (owner_user_id, full_name, age_years, sex, is_primary)
     VALUES ($1, $2, 29, 'male', false)
     RETURNING id`,
    [userId, name],
  );
}

/** Runs a statement that returns exactly one id. */
async function one(client: Client, sql: string, values: readonly unknown[]): Promise<string> {
  const { rows } = await client.query<{ id: string }>(sql, [...values]);
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`Expected one row from: ${sql}`);
  }
  return row.id;
}
