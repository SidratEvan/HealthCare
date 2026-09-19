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
  /** Booking ids by serial, so a spec can name "serial 7" and mean it. */
  readonly bookingsBySerial: ReadonlyMap<number, string>;
}

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
export async function createConsoleSession(bookings = 8): Promise<ConsoleSession> {
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

    const session = await client.query<{ id: string }>(
      `INSERT INTO sessions
         (hospital_id, doctor_id, department_id, room, session_date,
          planned_start, planned_end, capacity, fee_poisha)
       VALUES ($1, $2, $3, 'E2E', current_date,
               now() - interval '30 minutes', now() + interval '150 minutes',
               40, $4)
       RETURNING id`,
      [row.hospital_id, row.doctor_id, row.department_id, row.fee_poisha],
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

    // Drive it to the state the pitch opens on. Written as events, not as
    // column updates: the queue is derived from the log and nothing else
    // (`DB-P1`), so a fixture that set `status` directly would be building a
    // state the reducer could never produce.
    const firstBooking = bookingsBySerial.get(1);
    if (firstBooking === undefined) throw new Error('no serial 1');

    await appendEvent(client, sessionId, receptionistId, 'DOCTOR_ARRIVED', {
      arrivedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      minutesLate: 10,
    });
    await appendEvent(client, sessionId, receptionistId, 'PATIENT_CALLED', {
      bookingId: firstBooking,
      serial: 1,
    });

    await client.query(
      `UPDATE sessions
          SET status = 'running', actual_start = now() - interval '20 minutes'
        WHERE id = $1`,
      [sessionId],
    );
    await client.query(
      `UPDATE bookings SET status = 'in_chamber', called_at = now() - interval '4 minutes'
        WHERE id = $1`,
      [firstBooking],
    );

    return {
      sessionId,
      hospitalId: row.hospital_id,
      doctorId: row.doctor_id,
      departmentCode: row.department_code,
      receptionistId,
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
    };
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

/** Appends one event, the way the service would. */
async function appendEvent(
  client: Client,
  sessionId: string,
  staffId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO queue_events
       (session_id, type, booking_id, actor_staff_id, actor_role, payload)
     VALUES ($1, $2, $3, $4, 'receptionist', $5::jsonb)`,
    [
      sessionId,
      type,
      typeof payload['bookingId'] === 'string' ? payload['bookingId'] : null,
      staffId,
      JSON.stringify(payload),
    ],
  );
}

async function receptionistAt(client: Client, hospitalId: string): Promise<string> {
  const staff = await client.query<{ id: string }>(
    `SELECT su.id
       FROM staff_users su
       JOIN staff_roles sr ON sr.staff_user_id = su.id
      WHERE su.hospital_id = $1 AND sr.role = 'receptionist' AND su.deleted_at IS NULL
      LIMIT 1`,
    [hospitalId],
  );

  const id = staff.rows[0]?.id;
  if (id === undefined) throw new Error(`No receptionist seeded at hospital ${hospitalId}.`);
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
