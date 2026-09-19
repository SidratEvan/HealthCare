/**
 * The smallest row graph that exercises the schema: one facility, one
 * department, one doctor sitting there, one scheduled session, one account, one
 * profile, one booking on serial 1.
 *
 * ## Why this is in `database/seeds` and not in `database/tests`
 *
 * CLAUDE.md §6 requires tests to run against seeded demo data rather than
 * fixtures scattered through test files, and step 1 left
 * `database/tests/support/fixtures.ts` as an explicitly provisional stand-in until
 * the seeds existed. They exist now, so the graph is built here, out of the
 * same declared demo set (`./data`) and the same insert helpers (`./lib`) that
 * `pnpm db:seed` uses. `database/tests/support/fixtures.ts` is a thin re-export.
 *
 * There is therefore one description of demo data in the repository: change a
 * facility's coordinates in `data/hospitals.ts` and the schema suite's
 * geography assertion follows, because it reads the same declaration.
 *
 * ## Why not run the whole seed
 *
 * Most schema tests are about a single constraint — a phone that is not
 * normalised, a serial issued twice, a running session with no doctor — and
 * each runs inside a transaction it rolls back. Building two thousand rows to
 * prove that `users_phone_normalised` rejects `01712345678` would make the
 * suite slow without making it stronger. The full seed *is* exercised, by
 * `database/tests/seeds.test.ts`, which runs `seedDemoData` and asserts the
 * `FR-DEM-*` shape.
 */

import { doctor } from './data/doctors.js';
import { facility } from './data/hospitals.js';
import { specialty } from './data/reference.js';
import {
  DEMO_MARKER,
  DISABLED_PASSWORD,
  demoBmdc,
  demoEmail,
  demoPhone,
  labelBn,
  labelEn,
  taka,
} from './lib/demo.js';
import { one } from './lib/insert.js';

import type { Client } from 'pg';

/**
 * The facility and doctor the graph is built from.
 *
 * Both come from the declared demo set, so the graph is a subset of the real
 * demo rather than a parallel invention (CLAUDE.md §8).
 */
export const GRAPH_FACILITY = 'shapla-general';
export const GRAPH_DOCTOR = 'ayesha-siddika';

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

/** A phone number from the fixture block, normalised per `DB-P6`. */
export function demoTestPhone(index: number): string {
  return demoPhone('fixture', index);
}

/**
 * Builds the graph.
 *
 * Deliberately does **not** insert `hospital_settings`: the row is
 * `hospital_id`-keyed, and a test that asserts the documented policy defaults
 * inserts it itself. Nor does it set `actual_start` or move the session to
 * `running` — that transition is a constraint worth exercising
 * (`sessions_running_has_started`) rather than assuming.
 *
 * @param seed distinguishes one graph from another within a single
 *   transaction. Unique indexes on BMDC number, staff email and phone mean two
 *   graphs in one transaction need different values.
 */
export async function insertGraph(client: Client, seed = 1): Promise<Graph> {
  const declaredFacility = facility(GRAPH_FACILITY);
  const declaredDoctor = doctor(GRAPH_DOCTOR);
  const chamber = declaredDoctor.chambers[0];
  if (chamber === undefined) throw new Error(`${GRAPH_DOCTOR} holds no chamber.`);
  const department = specialty(chamber.departmentCode);

  const hospital = await one<{ id: string }>(
    client,
    `INSERT INTO hospitals
       (name_bn, name_en, kind, division, district, thana,
        address_bn, address_en, lat, lng, phone, is_live, onboarded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, now())
     RETURNING id`,
    [
      labelBn(`${declaredFacility.nameBn} ${seed}`),
      labelEn(`${declaredFacility.nameEn} ${seed}`),
      declaredFacility.kind,
      declaredFacility.division,
      declaredFacility.district,
      declaredFacility.thana,
      declaredFacility.addressBn,
      declaredFacility.addressEn,
      declaredFacility.lat,
      declaredFacility.lng,
      declaredFacility.phone,
    ],
  );

  const staff = await one<{ id: string }>(
    client,
    `INSERT INTO staff_users (hospital_id, email, staff_code, full_name, password_hash)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      hospital.id,
      demoEmail(`reception${String(seed)}`, GRAPH_FACILITY),
      `FIX-REC-${String(seed).padStart(2, '0')}`,
      labelBn('রুমানা খাতুন'),
      DISABLED_PASSWORD,
    ],
  );

  const departmentRow = await one<{ id: string }>(
    client,
    `INSERT INTO departments (hospital_id, name_bn, name_en, code, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [hospital.id, department.nameBn, department.nameEn, department.code, staff.id],
  );

  const doctorRow = await one<{ id: string }>(
    client,
    `INSERT INTO doctors
       (full_name_bn, full_name_en, bmdc_number, bmdc_verified_at,
        degrees, specialties, default_consult_minutes)
     VALUES ($1, $2, $3, now(), $4, $5, $6)
     RETURNING id`,
    [
      labelBn(declaredDoctor.nameBn),
      labelEn(declaredDoctor.nameEn),
      // The fixture block, so a graph and a seeded doctor never collide on
      // `doctors_bmdc_number_key`.
      demoBmdc(90000 + seed),
      declaredDoctor.degrees,
      declaredDoctor.specialties,
      declaredDoctor.consultMinutes,
    ],
  );

  const feePoisha = taka(chamber.feeTaka);

  const doctorHospital = await one<{ id: string }>(
    client,
    `INSERT INTO doctor_hospitals
       (doctor_id, hospital_id, department_id, fee_poisha, room, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [doctorRow.id, hospital.id, departmentRow.id, feePoisha, chamber.room, staff.id],
  );

  const user = await one<{ id: string }>(
    client,
    `INSERT INTO users (phone) VALUES ($1) RETURNING id`,
    [demoTestPhone(seed)],
  );

  const patient = await one<{ id: string }>(
    client,
    `INSERT INTO patients
       (owner_user_id, full_name, age_years, sex, blood_group, phone, is_primary)
     VALUES ($1, $2, 62, 'female', 'B+', $3, true)
     RETURNING id`,
    [user.id, labelBn('রহিমা খাতুন'), demoTestPhone(seed)],
  );

  const session = await one<{ id: string }>(
    client,
    `INSERT INTO sessions
       (hospital_id, doctor_id, department_id, room, session_date,
        planned_start, planned_end, status, capacity, fee_poisha, created_by)
     VALUES ($1, $2, $3, $4, (now() AT TIME ZONE 'Asia/Dhaka')::date,
             now(), now() + interval '3 hours', 'scheduled', 30, $5, $6)
     RETURNING id`,
    [hospital.id, doctorRow.id, departmentRow.id, chamber.room, feePoisha, staff.id],
  );

  const booking = await insertBooking(client, session.id, patient.id, user.id, 1);

  return {
    hospitalId: hospital.id,
    departmentId: departmentRow.id,
    doctorId: doctorRow.id,
    doctorHospitalId: doctorHospital.id,
    staffUserId: staff.id,
    userId: user.id,
    patientId: patient.id,
    sessionId: session.id,
    bookingId: booking,
  };
}

/**
 * One booking on a session, as `booked`.
 *
 * Status is not a parameter on purpose: `bookings.status` is derived from the
 * event log (DATABASE.md §2.3), so a test that wants a settled booking should
 * append the event that settles it.
 */
export async function insertBooking(
  client: Client,
  sessionId: string,
  patientId: string,
  userId: string | null,
  serial: number,
): Promise<string> {
  const fee = await one<{ fee_poisha: number }>(
    client,
    'SELECT fee_poisha FROM sessions WHERE id = $1',
    [sessionId],
  );

  const row = await one<{ id: string }>(
    client,
    `INSERT INTO bookings
       (session_id, patient_id, booked_by_user_id, serial_number, status, source,
        intake, fee_poisha)
     VALUES ($1, $2, $3, $4, 'booked', 'app', $5, $6)
     RETURNING id`,
    [sessionId, patientId, userId, serial, JSON.stringify(DEMO_MARKER), fee.fee_poisha],
  );

  return row.id;
}

/** A second profile on the same account, for the multi-profile cases. */
export async function insertExtraPatient(
  client: Client,
  userId: string,
  name = labelBn('সুমন ইসলাম'),
): Promise<string> {
  const row = await one<{ id: string }>(
    client,
    `INSERT INTO patients (owner_user_id, full_name, age_years, sex, relationship, is_primary)
     VALUES ($1, $2, 29, 'male', 'child', false)
     RETURNING id`,
    [userId, name],
  );
  return row.id;
}
