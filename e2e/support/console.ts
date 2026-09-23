/**
 * What every console spec needs: a session to drive and a way in.
 *
 * Reads and writes the seeded demo database directly rather than through the
 * API. These are end-to-end tests of the *product*, and the fixture that sets
 * them up should not depend on the endpoints they are exercising — a broken
 * `/sync/session` should fail the assertion, not the setup.
 *
 * ## Why each spec gets its own session
 *
 * `queue_events` is append-only (`DB-P1`), so a test cannot clean up after
 * itself. Sharing the seeded pitch session would make every spec depend on
 * what the previous one consumed: the spec that calls five patients leaves the
 * chamber empty, and the next spec's assertion about who is being served fails
 * for a reason that has nothing to do with the code it is testing. That is the
 * flakiness CLAUDE.md §6 calls a bug.
 *
 * So `createConsoleSession` builds a fresh session out of seeded rows — the
 * same approach `createQueueFixture` takes in the API suite — and drives it to
 * the state the pitch opens on: doctor arrived, one patient in the chamber,
 * the rest waiting. Only `loadPitchSession` touches the demo's own session,
 * and only to read it.
 */

import { Client } from 'pg';

import { signToken } from '../../backend/api/src/config/jwt.js';

import { E2E_DATABASE_URL, assertLocalDatabase } from './database.js';

// Importing `signToken` pulls in the API's `env.ts`, which merges the
// repository's `.env` into `process.env` as an import side effect. That is why
// the connection URL comes from `database.ts` and not from `DATABASE_URL`:
// see the note there.
assertLocalDatabase();

const DATABASE_URL = E2E_DATABASE_URL;

/** The API the specs drive, matching `playwright.config.ts`. */
const API_BASE = 'http://localhost:4000/api/v1';

export interface ConsoleSession {
  readonly sessionId: string;
  readonly hospitalId: string;
  readonly receptionistId: string;
  /** The doctor this chamber belongs to — the patient app books them by id. */
  readonly doctorId: string;
  /** The department code, which is what a specialty URL carries. */
  readonly departmentCode: string;
  readonly token: string;
  /**
   * The same chamber, seen by the doctor (`S-B-05`).
   *
   * A separate principal rather than the receptionist's with another role added:
   * `visits.created_by` is a foreign key to `staff_users`, so the doctor console
   * can only write a record as somebody who actually exists — and the two
   * consoles being different people is the situation `FR-QUE-53` serialises.
   */
  readonly doctorToken: string;
  /** The seeded doctor account at this hospital, for `visits.created_by`. */
  readonly doctorStaffId: string;
  /** Booking ids by serial, so a spec can name "serial 7" and mean it. */
  readonly bookingsBySerial: ReadonlyMap<number, string>;
  /** What this chamber charges, copied onto every booking (`DB-P5`). */
  readonly feePoisha: number;
}

/**
 * Where a fresh session opens.
 *
 * - `in-chamber` — the state the pitch opens on: the doctor arrived twenty
 *   minutes ago and serial 1 is being seen.
 * - `overdue` — the doctor arrived eighty minutes ago, serial 1 finished
 *   seventy minutes ago, and serial 2 is at the front of an empty chamber.
 *   Serial 2's grace period (`FR-QUE-20`) has long since run out, so reception
 *   may mark them absent — which is the only honest way to reach a no-show
 *   without a spec waiting fifteen real minutes.
 */
export type SessionOpening = 'in-chamber' | 'overdue';

async function withClient<T>(body: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    connectionString: DATABASE_URL,
    options: '-c search_path=public,extensions',
  });
  await client.connect();
  try {
    return await body(client);
  } finally {
    await client.end();
  }
}

/**
 * A fresh session, mid-queue, driven by a real receptionist.
 *
 * Built from seeded rows — a real chamber, real patients, the fee that doctor
 * actually charges — so what a spec drives is the product, not an invention.
 * The only thing that is not seeded is the session itself, and that is
 * precisely so one spec cannot disturb another.
 */
export async function createConsoleSession(
  bookings = 8,
  opening: SessionOpening = 'in-chamber',
): Promise<ConsoleSession> {
  const overdue = opening === 'overdue';

  return await withClient(async (client) => {
    const chamber = await client.query<{
      hospital_id: string;
      doctor_id: string;
      department_id: string;
      department_code: string;
      fee_poisha: number;
    }>(
      `SELECT dh.hospital_id, dh.doctor_id, dh.department_id,
              dep.code AS department_code, dh.fee_poisha
         FROM doctor_hospitals dh
         JOIN doctors d ON d.id = dh.doctor_id
         JOIN departments dep ON dep.id = dh.department_id
         JOIN hospitals h ON h.id = dh.hospital_id
        WHERE dh.deleted_at IS NULL AND dh.is_active
          AND h.is_live AND h.deleted_at IS NULL
          AND d.bmdc_verified_at IS NOT NULL
        ORDER BY d.bmdc_number
        LIMIT 1`,
    );

    const row = chamber.rows[0];
    if (row === undefined) {
      throw new Error('No seeded chamber. Run `pnpm db:reset` before `pnpm test:e2e`.');
    }

    /*
     * The session date is Dhaka's, not the server's.
     *
     * `current_date` is UTC, and the session picker filters on
     * `toDhakaDate(now)` (`discovery.service.today`). Between midnight and six
     * in the morning in Dhaka the two disagree, so a session inserted here was
     * filed under yesterday and never appeared in the picker — and every spec
     * that books through the UI timed out waiting for a session card. The
     * product was fine; the fixture was six hours ahead of it.
     */
    const session = await client.query<{ id: string }>(
      `INSERT INTO sessions
         (hospital_id, doctor_id, department_id, room, session_date,
          planned_start, planned_end, capacity, fee_poisha)
       VALUES ($1, $2, $3, 'E2E', (now() AT TIME ZONE 'Asia/Dhaka')::date,
               now() - make_interval(mins => $5), now() + interval '150 minutes',
               40, $4)
       RETURNING id`,
      [row.hospital_id, row.doctor_id, row.department_id, row.fee_poisha, overdue ? 90 : 30],
    );

    const sessionId = session.rows[0]?.id;
    if (sessionId === undefined) throw new Error('session insert returned no id.');

    // Distinct patients: `bookings_one_live_per_patient_per_session` is a
    // unique index, and a queue holding one person twice is not a state worth
    // driving a console against.
    const patients = await client.query<{ id: string }>(
      'SELECT id FROM patients WHERE deleted_at IS NULL ORDER BY created_at, id LIMIT $1',
      [bookings],
    );

    if (patients.rows.length < bookings) {
      throw new Error(
        `Need ${String(bookings)} seeded patients, found ${String(patients.rows.length)}.`,
      );
    }

    const bookingsBySerial = new Map<number, string>();
    for (const [index, patient] of patients.rows.entries()) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO bookings
           (session_id, patient_id, serial_number, source, fee_poisha, intake)
         VALUES ($1, $2, $3, 'app', $4, '{"demo":true}'::jsonb)
         RETURNING id`,
        [sessionId, patient.id, index + 1, row.fee_poisha],
      );
      const bookingId = inserted.rows[0]?.id;
      if (bookingId === undefined) throw new Error('booking insert returned no id.');
      bookingsBySerial.set(index + 1, bookingId);
    }

    const receptionistId = await receptionistAt(client, row.hospital_id);
    const doctorStaffId = await staffAt(client, row.hospital_id, 'doctor');

    // Drive it to the state the pitch opens on. Written as events, not as
    // column updates: the queue is derived from the log and nothing else
    // (`DB-P1`), so a fixture that set `status` directly would be building a
    // state the reducer could never produce.
    const firstBooking = bookingsBySerial.get(1);
    if (firstBooking === undefined) throw new Error('no serial 1');

    //
    // An overdue session's events are stamped in the past, which is what
    // `server_ts` would say had the console been driven an hour ago. The
    // grace period reads that column, so this is the log the reducer would
    // have produced — not a status set by hand.
    const arrivedMinutesAgo = overdue ? 80 : 20;

    await appendEvent(
      client,
      sessionId,
      receptionistId,
      'DOCTOR_ARRIVED',
      {
        arrivedAt: new Date(Date.now() - arrivedMinutesAgo * 60_000).toISOString(),
        minutesLate: 10,
      },
      overdue ? arrivedMinutesAgo : 0,
    );
    await appendEvent(
      client,
      sessionId,
      receptionistId,
      'PATIENT_CALLED',
      { bookingId: firstBooking, serial: 1 },
      overdue ? 75 : 0,
    );

    await client.query(
      `UPDATE sessions
          SET status = 'running', actual_start = now() - make_interval(mins => $2)
        WHERE id = $1`,
      [sessionId, arrivedMinutesAgo],
    );

    if (overdue) {
      await appendEvent(
        client,
        sessionId,
        receptionistId,
        'PATIENT_DONE',
        { bookingId: firstBooking, consultSeconds: 300 },
        70,
      );
      await client.query(
        `UPDATE bookings
            SET status = 'done', called_at = now() - interval '75 minutes',
                done_at = now() - interval '70 minutes', consult_seconds = 300
          WHERE id = $1`,
        [firstBooking],
      );
    } else {
      await client.query(
        `UPDATE bookings SET status = 'in_chamber', called_at = now() - interval '4 minutes'
          WHERE id = $1`,
        [firstBooking],
      );
    }

    return {
      sessionId,
      hospitalId: row.hospital_id,
      doctorId: row.doctor_id,
      departmentCode: row.department_code,
      receptionistId,
      doctorStaffId,
      doctorToken: await signToken({
        kind: 'access',
        claims: {
          sub: doctorStaffId,
          kind: 'staff',
          hospitalId: row.hospital_id,
          roles: ['doctor'],
        },
      }),
      // Under DEMO_MODE the console selects a hospital and a role without a
      // password (CLAUDE.md §4.1); this is that selection, made for it.
      token: await signToken({
        kind: 'access',
        claims: {
          sub: receptionistId,
          kind: 'staff',
          hospitalId: row.hospital_id,
          roles: ['receptionist'],
        },
      }),
      bookingsBySerial,
      feePoisha: row.fee_poisha,
    };
  });
}

/**
 * Puts seeded patients on this session's standby list (`FR-PAT-25`).
 *
 * People who hold no booking on it — somebody already in the queue is not
 * waiting for a chair. The number is on the demo standby range
 * (`database/seeds/lib/demo.ts`, `+8801350…`), so an SMS written to it is
 * recognisably a demonstration message.
 */
export async function joinStandby(session: ConsoleSession, count: number): Promise<void> {
  await withClient(async (client) => {
    const patients = await client.query<{ id: string }>(
      `SELECT p.id FROM patients p
        WHERE p.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM bookings b
                           WHERE b.session_id = $1 AND b.patient_id = p.id)
        ORDER BY p.created_at DESC, p.id
        LIMIT $2`,
      [session.sessionId, count],
    );

    if (patients.rows.length < count) {
      throw new Error(`Need ${String(count)} seeded patients off this session.`);
    }

    for (const [index, patient] of patients.rows.entries()) {
      await client.query(
        `INSERT INTO standby_list (session_id, patient_id, contact_phone, position)
         VALUES ($1, $2, $3, $4)`,
        [session.sessionId, patient.id, `+88013509900${String(index + 10)}`, index + 1],
      );
    }
  });
}

/**
 * Fills the chamber: capacity lowered to the serials it already holds, so the
 * patient app shows it পূর্ণ and offers its standby list (`FR-PAT-25`).
 */
export async function fillSession(session: ConsoleSession): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `UPDATE sessions
          SET capacity = (SELECT count(*) FROM bookings b
                           WHERE b.session_id = sessions.id AND b.status <> 'cancelled')
        WHERE id = $1`,
      [session.sessionId],
    );
  });
}

/**
 * The seeded administrator at a hospital, as `S-B-10` would be opened by one.
 *
 * The same signed staff token the picker's `POST /demo/token` mints for the
 * `hospital_admin` role (CLAUDE.md §4.1).
 */
export async function adminToken(hospitalId: string): Promise<string> {
  return await withClient(async (client) => {
    const adminId = await staffAt(client, hospitalId, 'hospital_admin');
    return await signToken({
      kind: 'access',
      claims: { sub: adminId, kind: 'staff', hospitalId, roles: ['hospital_admin'] },
    });
  });
}

/**
 * The demo's own mid-queue session (`FR-DEM-06`), for read-only assertions.
 *
 * This is the session a hospital director will actually be shown, so a spec
 * that checks the pitch opens correctly should check *this* one — but never
 * write to it, or the next reset is the only way back.
 */
export async function loadPitchSession(): Promise<{
  readonly sessionId: string;
  readonly token: string;
}> {
  return await withClient(async (client) => {
    const session = await client.query<{ id: string; hospital_id: string }>(
      `SELECT id, hospital_id FROM sessions
        WHERE status = 'running' AND room <> 'E2E' AND deleted_at IS NULL
        ORDER BY planned_start DESC LIMIT 1`,
    );

    const row = session.rows[0];
    if (row === undefined) {
      throw new Error(
        'No running demo session. Run `pnpm db:reset` before `pnpm test:e2e` (FR-DEM-06).',
      );
    }

    const receptionistId = await receptionistAt(client, row.hospital_id);

    return {
      sessionId: row.id,
      token: await signToken({
        kind: 'access',
        claims: {
          sub: receptionistId,
          kind: 'staff',
          hospitalId: row.hospital_id,
          roles: ['receptionist'],
        },
      }),
    };
  });
}

/**
 * Appends one event, the way the service would.
 *
 * `minutesAgo` stamps `server_ts` in the past, for a session that is meant to
 * have been running for a while. Events are appended in the order written, so
 * `seq` and `server_ts` still agree.
 */
async function appendEvent(
  client: Client,
  sessionId: string,
  staffId: string,
  type: string,
  payload: Record<string, unknown>,
  minutesAgo = 0,
): Promise<void> {
  await client.query(
    `INSERT INTO queue_events
       (session_id, type, booking_id, actor_staff_id, actor_role, payload, server_ts)
     VALUES ($1, $2, $3, $4, 'receptionist', $5::jsonb, now() - make_interval(mins => $6))`,
    [
      sessionId,
      type,
      typeof payload['bookingId'] === 'string' ? payload['bookingId'] : null,
      staffId,
      JSON.stringify(payload),
      minutesAgo,
    ],
  );
}

async function receptionistAt(client: Client, hospitalId: string): Promise<string> {
  return await staffAt(client, hospitalId, 'receptionist');
}

/**
 * A seeded staff account holding one role at one facility.
 *
 * Real rows, because `queue_events.actor_staff_id` and `visits.created_by` are
 * both foreign keys: an invented id is refused by the database, which is the
 * property that makes an unattributable action impossible rather than merely
 * discouraged (`FR-QUE-04`).
 */
async function staffAt(client: Client, hospitalId: string, role: string): Promise<string> {
  const staff = await client.query<{ id: string }>(
    `SELECT su.id
       FROM staff_users su
       JOIN staff_roles sr ON sr.staff_user_id = su.id
      WHERE su.hospital_id = $1 AND sr.role = $2::staff_role AND su.deleted_at IS NULL
      LIMIT 1`,
    [hospitalId, role],
  );

  const id = staff.rows[0]?.id;
  if (id === undefined) throw new Error(`No ${role} seeded at hospital ${hospitalId}.`);
  return id;
}

/** How many events the log holds for a session — the idempotency assertion. */
export async function eventCount(sessionId: string): Promise<number> {
  return await withClient(async (client) => {
    const result = await client.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM queue_events WHERE session_id = $1',
      [sessionId],
    );
    return Number(result.rows[0]?.n ?? '0');
  });
}

/** Event types for a session, in log order — proves the replay's ordering. */
export async function eventTypes(sessionId: string): Promise<string[]> {
  return await withClient(async (client) => {
    const result = await client.query<{ type: string }>(
      'SELECT type FROM queue_events WHERE session_id = $1 ORDER BY seq',
      [sessionId],
    );
    return result.rows.map((r) => r.type);
  });
}

/**
 * One booking on a session, by serial.
 *
 * Proves a screen's claim against the row behind it: a success page showing
 * serial four and no booking at serial four is the failure worth catching.
 */
export async function bookingBySerial(
  sessionId: string,
  serial: number,
): Promise<{ readonly id: string; readonly source: string } | null> {
  return await withClient(async (client) => {
    const result = await client.query<{ id: string; source: string }>(
      `SELECT id, source::text AS source FROM bookings
        WHERE session_id = $1 AND serial_number = $2 AND status <> 'cancelled'`,
      [sessionId, serial],
    );

    const row = result.rows[0];
    return row === undefined ? null : { id: row.id, source: row.source };
  });
}

/**
 * Revokes a booking's tracking link (`FR-GST-05`).
 *
 * "The link is single-booking scoped, expires after the session ends plus a
 * grace period, and is **revocable**." Revocation is one row, and this is what
 * a hospital switching a link off would do — so a spec can prove the screen
 * behind it stops rather than going on showing a number.
 */
export async function revokeTrackingLink(bookingId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query('UPDATE guest_links SET revoked_at = now() WHERE booking_id = $1', [
      bookingId,
    ]);
  });
}

/**
 * Performs a queue action over the API, as a console would.
 *
 * Used where the console has no control for it yet. `BTN-B02-DELAY` and
 * `MOD-B02-DELAY` are named in `APP_FLOW.md` B1.2 but were not built in step 8,
 * so a spec that needs a declared delay — to prove the *patient* screen reacts
 * to one (`FR-PAT-34`) — has to raise it the way that button eventually will.
 *
 * This goes through the real endpoint, with a real staff token, producing a
 * real broadcast. It is not a shortcut around the server; it is a stand-in for
 * one missing button.
 */
export async function queueAction(
  session: ConsoleSession,
  path: string,
  body: Record<string, unknown> = {},
): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.token}`,
      'idempotency-key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${path} failed: ${String(response.status)} ${await response.text()}`);
  }
}

/**
 * Files a visit record as `BTN-B05-SIGN` does, through `POST /visits`.
 *
 * For specs about what happens *after* a doctor signs — the wallet — rather
 * than about signing, which `doctor-console.spec.ts` drives through the screen.
 * A real endpoint and the doctor's own token, so the record, the audit row and
 * the queue advance are the product's, not the fixture's.
 */
export async function signVisit(
  session: ConsoleSession,
  bookingId: string,
  record: { readonly diagnosisText: string; readonly adviceTextBn: string },
): Promise<void> {
  const key = crypto.randomUUID();

  const response = await fetch(`${API_BASE}/visits`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.doctorToken}`,
      'idempotency-key': key,
    },
    body: JSON.stringify({ bookingId, ...record, sign: true, idempotencyKey: key }),
  });

  if (!response.ok) {
    throw new Error(`/visits failed: ${String(response.status)} ${await response.text()}`);
  }
}

/**
 * The consent trail for the patient a booking is for (`FR-PAT-64`, `FR-SEC-03`).
 *
 * What step 13's definition of done asks of the database: a grant written, a
 * revocation that is a timestamp rather than a delete, and an audit row for
 * every staff read.
 */
export async function consentTrail(bookingId: string): Promise<{
  readonly grants: number;
  readonly revoked: number;
  readonly staffReads: number;
}> {
  return await withClient(async (client) => {
    const result = await client.query<{ grants: string; revoked: string; staff_reads: string }>(
      `SELECT
         (SELECT count(*) FROM consents c WHERE c.patient_id = b.patient_id)::text AS grants,
         (SELECT count(*) FROM consents c
           WHERE c.patient_id = b.patient_id AND c.revoked_at IS NOT NULL)::text AS revoked,
         (SELECT count(*) FROM audit_log a
           WHERE a.patient_id = b.patient_id AND a.action = 'RECORD_VIEW'
             AND a.actor_staff_id IS NOT NULL)::text AS staff_reads
         FROM bookings b
        WHERE b.id = $1`,
      [bookingId],
    );

    const row = result.rows[0];
    if (row === undefined) throw new Error(`no booking ${bookingId}`);

    return {
      grants: Number(row.grants),
      revoked: Number(row.revoked),
      staffReads: Number(row.staff_reads),
    };
  });
}
