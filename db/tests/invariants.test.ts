/**
 * The DATABASE.md §0 principles, checked against the real schema.
 *
 * `pnpm db:verify` runs the same checks against a developer's database; this
 * suite runs them against a database built from scratch a moment ago, and adds
 * the cases that need a write to prove — a constraint that is present but
 * misspelled enforces nothing, and only an attempted insert can tell the
 * difference.
 */

import { describe, expect, it } from 'vitest';

import { verifySchema } from '../scripts/lib/verify.js';

import { connect, expectRejection, withRollback } from './support/database.js';
import { insertExtraPatient, insertGraph, insertBooking } from './support/fixtures.js';

describe('schema invariants (DATABASE.md §0)', () => {
  it('holds every invariant db:verify checks', async () => {
    const client = await connect();
    try {
      const violations = await verifySchema(client);
      expect(violations, formatViolations(violations)).toEqual([]);
    } finally {
      await client.end();
    }
  });
});

describe('DB-P3: created_at and updated_at are maintained, not merely present', () => {
  /**
   * Committed rather than rolled back, because `fn_touch_updated_at` uses
   * `now()` — the transaction timestamp — so two updates inside one
   * transaction share a stamp by design. That choice is deliberate: a stamp
   * taken at transaction start can only ever make data look older than it is,
   * and for a product whose freshness line is a promise, erring old is the
   * only safe direction (FR-OFF-03).
   *
   * So this test spans two transactions and cleans up after itself.
   */
  it('advances updated_at on a later transaction, and never moves created_at', async () => {
    const client = await connect();
    let hospitalId: string | undefined;

    try {
      const { rows: inserted } = await client.query<{
        id: string;
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO hospitals (name_bn, name_en, kind, division, district)
         VALUES ('ডেমো টাইমস্ট্যাম্প', 'Demo Timestamp', 'clinic', 'Dhaka', 'Dhaka')
         RETURNING id, created_at, updated_at`,
      );
      const before = inserted[0];
      if (before === undefined) throw new Error('insert failed');
      hospitalId = before.id;

      await client.query('SELECT pg_sleep(0.05)');
      await client.query(`UPDATE hospitals SET name_en = 'Demo Timestamp renamed' WHERE id = $1`, [
        hospitalId,
      ]);

      const after = await readTimestamps(client, hospitalId);

      expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
      expect(after.created_at.getTime()).toBe(before.created_at.getTime());
    } finally {
      if (hospitalId !== undefined) {
        await client.query('DELETE FROM hospitals WHERE id = $1', [hospitalId]);
      }
      await client.end();
    }
  });

  it('stamps every row written in one transaction with the same transaction time', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      await client.query(`UPDATE hospitals SET name_en = 'Renamed' WHERE id = $1`, [
        graph.hospitalId,
      ]);
      await client.query(`UPDATE doctors SET degrees = 'MBBS' WHERE id = $1`, [graph.doctorId]);

      const { rows } = await client.query<{ same: boolean }>(
        `SELECT (SELECT updated_at FROM hospitals WHERE id = $1)
              = (SELECT updated_at FROM doctors WHERE id = $2) AS same`,
        [graph.hospitalId, graph.doctorId],
      );
      expect(rows[0]?.same).toBe(true);
    });
  });

  it('ignores an updated_at supplied by the caller, because the server clock decides', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      await client.query(`UPDATE hospitals SET updated_at = '2001-01-01T00:00:00Z' WHERE id = $1`, [
        graph.hospitalId,
      ]);

      const { updated_at } = await readTimestamps(client, graph.hospitalId);
      expect(updated_at.getFullYear()).toBeGreaterThan(2020);
    });
  });
});

describe('DB-P6: phone numbers are stored normalised', () => {
  it.each([
    ['01712345678', 'no country code'],
    ['+8801012345678', 'invalid operator digit'],
    ['+880171234567', 'too short'],
    ['+88017123456789', 'too long'],
    ['+8801712 345678', 'contains a space'],
  ])('rejects %s (%s)', async (phone) => {
    await withRollback(async (client) => {
      const error = await expectRejection(client, () =>
        client.query('INSERT INTO users (phone) VALUES ($1)', [phone]),
      );
      expect(error.constraint).toBe('users_phone_normalised');
    });
  });

  it('accepts a normalised +8801 number', async () => {
    await withRollback(async (client) => {
      await client.query('INSERT INTO users (phone) VALUES ($1)', ['+8801712345678']);
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM users WHERE phone = '+8801712345678'`,
      );
      expect(rows[0]?.count).toBe('1');
    });
  });
});

describe('patients belong to exactly one owner', () => {
  it('refuses a patient with no owner', async () => {
    await withRollback(async (client) => {
      const error = await expectRejection(client, () =>
        client.query(
          `INSERT INTO patients (full_name, age_years, sex) VALUES ('Nobody', 30, 'male')`,
        ),
      );
      expect(error.constraint).toBe('patients_one_owner');
    });
  });

  it('refuses a patient owned by both a user and a guest', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO guest_identities (phone, display_name)
         VALUES ('+8801912345678', 'ডেমো অতিথি') RETURNING id`,
      );
      const guestId = rows[0]?.id;

      const error = await expectRejection(client, () =>
        client.query(
          `INSERT INTO patients (owner_user_id, owner_guest_id, full_name, age_years, sex)
           VALUES ($1, $2, 'Both', 30, 'male')`,
          [graph.userId, guestId],
        ),
      );
      expect(error.constraint).toBe('patients_one_owner');
    });
  });

  it('requires an age in one form or the other', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      const error = await expectRejection(client, () =>
        client.query(
          `INSERT INTO patients (owner_user_id, full_name, sex) VALUES ($1, 'Ageless', 'other')`,
          [graph.userId],
        ),
      );
      expect(error.constraint).toBe('patients_age_known');
    });
  });

  it('allows several profiles per account but only one marked primary (FR-PAT-02)', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      await insertExtraPatient(client, graph.userId);

      const { rows } = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM patients WHERE owner_user_id = $1',
        [graph.userId],
      );
      expect(rows[0]?.count).toBe('2');

      const error = await expectRejection(client, () =>
        client.query(
          `INSERT INTO patients (owner_user_id, full_name, age_years, sex, is_primary)
           VALUES ($1, 'Second primary', 40, 'male', true)`,
          [graph.userId],
        ),
      );
      expect(error.constraint).toBe('patients_one_primary_per_user');
    });
  });
});

describe('serials are unique within a session', () => {
  it('refuses a duplicate live serial', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const other = await insertExtraPatient(client, graph.userId);

      const error = await expectRejection(client, () =>
        insertBooking(client, graph.sessionId, other, graph.userId, 1),
      );
      expect(error.constraint).toBe('bookings_session_serial_key');
    });
  });

  it('frees a serial for reissue once a booking is cancelled (FR-QUE-30)', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const standby = await insertExtraPatient(client, graph.userId);

      await client.query(
        `UPDATE bookings SET status = 'cancelled', cancelled_reason = 'patient cancelled'
         WHERE id = $1`,
        [graph.bookingId],
      );

      const reissued = await insertBooking(client, graph.sessionId, standby, graph.userId, 1);
      expect(reissued).toMatch(/^[0-9a-f-]{36}$/);

      // The cancelled row stays in history (DB-P2).
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM bookings
         WHERE session_id = $1 AND serial_number = 1`,
        [graph.sessionId],
      );
      expect(rows[0]?.count).toBe('2');
    });
  });

  it('refuses two live bookings for one patient in one session', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      const error = await expectRejection(client, () =>
        insertBooking(client, graph.sessionId, graph.patientId, graph.userId, 2),
      );
      expect(error.constraint).toBe('bookings_one_live_per_patient_per_session');
    });
  });

  it('requires a reason when a booking is cancelled (FR-PAY-03)', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      const error = await expectRejection(client, () =>
        client.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [graph.bookingId]),
      );
      expect(error.constraint).toBe('bookings_cancelled_has_reason');
    });
  });
});

describe('a running session has a doctor in the chamber', () => {
  it('refuses status running without an actual start', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      const error = await expectRejection(client, () =>
        client.query(`UPDATE sessions SET status = 'running' WHERE id = $1`, [graph.sessionId]),
      );
      expect(error.constraint).toBe('sessions_running_has_started');
    });
  });

  it('accepts running once DOCTOR_ARRIVED has set actual_start', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      await client.query(
        `UPDATE sessions SET actual_start = now(), status = 'running' WHERE id = $1`,
        [graph.sessionId],
      );

      const { rows } = await client.query<{ status: string }>(
        'SELECT status FROM sessions WHERE id = $1',
        [graph.sessionId],
      );
      expect(rows[0]?.status).toBe('running');
    });
  });
});

describe('hospital geography is derived, never entered twice (DATABASE.md §6)', () => {
  it('generates the geo point from lat and lng', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      const { rows } = await client.query<{ lat: number; lng: number }>(
        `SELECT ST_Y(geo::geometry) AS lat, ST_X(geo::geometry) AS lng
         FROM hospitals WHERE id = $1`,
        [graph.hospitalId],
      );

      expect(rows[0]?.lat).toBeCloseTo(23.7806, 4);
      expect(rows[0]?.lng).toBeCloseTo(90.4074, 4);
    });
  });

  it('refuses to have geo written directly', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      const error = await expectRejection(client, () =>
        client.query(
          `UPDATE hospitals SET geo = ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography WHERE id = $1`,
          [graph.hospitalId],
        ),
      );
      // 428C9: cannot insert or update a generated column.
      expect(error.code).toBe('428C9');
      expect(error.message).toContain('geo');
    });
  });

  it('refuses a coordinate outside Bangladesh, which would produce a confident wrong travel time', async () => {
    await withRollback(async (client) => {
      const error = await expectRejection(client, () =>
        client.query(
          `INSERT INTO hospitals (name_bn, name_en, kind, division, district, lat, lng)
           VALUES ('ভুল', 'Wrong', 'hospital', 'Dhaka', 'Dhaka', 51.5072, -0.1276)`,
        ),
      );
      expect(error.constraint).toBe('hospitals_lat_in_bangladesh');
    });
  });

  it('refuses a facility published live before it was onboarded', async () => {
    await withRollback(async (client) => {
      const error = await expectRejection(client, () =>
        client.query(
          `INSERT INTO hospitals (name_bn, name_en, kind, division, district, is_live)
           VALUES ('অপ্রস্তুত', 'Unverified', 'hospital', 'Dhaka', 'Dhaka', true)`,
        ),
      );
      expect(error.constraint).toBe('hospitals_live_requires_onboarding');
    });
  });
});

describe('hospital settings default to the documented policy', () => {
  it('matches FR-QUE-20, FR-QUE-21 and FR-OFF-04 without anyone opening a settings screen', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      await client.query('INSERT INTO hospital_settings (hospital_id) VALUES ($1)', [
        graph.hospitalId,
      ]);

      const { rows } = await client.query<{
        no_show_grace_patients: number;
        no_show_grace_minutes: number;
        late_reinsert_after: number;
        stale_threshold_minutes: number;
      }>(
        `SELECT no_show_grace_patients, no_show_grace_minutes, late_reinsert_after,
                stale_threshold_minutes
         FROM hospital_settings WHERE hospital_id = $1`,
        [graph.hospitalId],
      );

      expect(rows[0]).toEqual({
        no_show_grace_patients: 2,
        no_show_grace_minutes: 15,
        late_reinsert_after: 3,
        stale_threshold_minutes: 10,
      });
    });
  });
});

async function readTimestamps(
  client: Awaited<ReturnType<typeof connect>>,
  hospitalId: string,
): Promise<{ created_at: Date; updated_at: Date }> {
  const { rows } = await client.query<{ created_at: Date; updated_at: Date }>(
    'SELECT created_at, updated_at FROM hospitals WHERE id = $1',
    [hospitalId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('hospital not found');
  return row;
}

function formatViolations(violations: readonly { rule: string; subject: string }[]): string {
  if (violations.length === 0) return '';
  return `\n${violations.map((v) => `  ${v.rule}: ${v.subject}`).join('\n')}\n`;
}
