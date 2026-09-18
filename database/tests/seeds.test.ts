/**
 * The demo data, asserted against the requirements that describe it.
 *
 * `FR-DEM-01` … `FR-DEM-07` are specific — six facilities of named kinds, ~40
 * doctors across eight specialties with fees between 500 and 2,000 BDT, ~200
 * profiles, ~500 historical visits, a session mid-queue, everything labelled.
 * Those are checkable claims, and a seed that quietly drifts to 38 doctors or
 * stops labelling a table would otherwise be found during a pitch.
 *
 * The whole seed runs once here, inside a transaction that is rolled back —
 * the only cleanup an append-only log permits (`DB-P1`), and the reason this
 * suite can share one database with every other test file.
 */

import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_COUNT,
  DEMO_DOCTORS,
  DEMO_FACILITIES,
  DEMO_LABEL_BN,
  DEMO_LABEL_EN,
  DEMO_LIVE,
  DEMO_SEED,
  GUEST_COUNT,
  HISTORY_VISIT_TARGET,
  PATIENT_COUNT,
  seedDemoData,
  SPECIALTIES,
  type SeedResult,
} from '../seeds/index.js';
import { createRng } from '../seeds/lib/random.js';

import { withRollback } from './support/database.js';

import type { Client } from 'pg';

/**
 * One seed run, shared by every assertion in this file.
 *
 * The body may be synchronous: an assertion about what the *runner* reported
 * needs no further queries, and forcing it to be async would be ceremony.
 */
async function seeded<T>(body: (client: Client, result: SeedResult) => T | Promise<T>): Promise<T> {
  return await withRollback(async (client) => {
    const result = await seedDemoData(client);
    return await body(client, result);
  });
}

/** `count(*)` as a number, because pg returns bigint as a string. */
async function count(client: Client, sql: string, values: unknown[] = []): Promise<number> {
  const { rows } = await client.query<{ n: string }>(sql, values);
  return Number(rows[0]?.n ?? '0');
}

// The full seed writes a few thousand rows over a few hundred statements.
const SEED_TIMEOUT = 180_000;

describe('FR-DEM-01: six facilities, of the kinds the requirement names', () => {
  it(
    'writes exactly the declared demo set',
    async () => {
      await seeded(async (client) => {
        const { rows } = await client.query<{ kind: string; district: string; name_en: string }>(
          'SELECT kind, district, name_en FROM hospitals ORDER BY name_en',
        );

        expect(rows).toHaveLength(6);
        expect(rows.filter((row) => row.kind === 'hospital')).toHaveLength(3);
        expect(rows.filter((row) => row.kind === 'government')).toHaveLength(1);
        expect(rows.filter((row) => row.kind === 'diagnostic')).toHaveLength(1);
        expect(rows.filter((row) => row.kind === 'clinic')).toHaveLength(1);

        // Two large private in Dhaka, one mid-size private in Chattogram.
        const chattogram = rows.filter((row) => row.district === 'Chattogram');
        expect(chattogram).toHaveLength(1);
        expect(chattogram[0]?.kind).toBe('hospital');
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'publishes every facility, because an un-onboarded one is invisible',
    async () => {
      await seeded(async (client) => {
        const hidden = await count(
          client,
          'SELECT count(*)::text AS n FROM hospitals WHERE NOT is_live OR onboarded_at IS NULL',
        );
        expect(hidden).toBe(0);
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'gives two facilities a burn unit and derives geography from the coordinates',
    async () => {
      await seeded(async (client) => {
        const burn = await count(
          client,
          `SELECT count(*)::text AS n FROM capabilities WHERE kind = 'burn_unit'`,
        );
        expect(burn).toBe(2);

        // `hospitals.geo` is generated; a null one would silently drop the
        // facility out of every emergency search (FR-PAT-43).
        const ungeocoded = await count(
          client,
          'SELECT count(*)::text AS n FROM hospitals WHERE geo IS NULL',
        );
        expect(ungeocoded).toBe(0);
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'leaves one facility deliberately stale, so freshness has something to show',
    async () => {
      await seeded(async (client) => {
        // FR-OFF-04 / FR-PAT-45: a stale capability row is labelled and de-ranked.
        // The demo cannot demonstrate either if every row was written a second ago.
        const stale = await count(
          client,
          `SELECT count(*)::text AS n
           FROM capabilities c
           JOIN hospital_settings s ON s.hospital_id = c.hospital_id
          WHERE c.updated_at < now() - make_interval(mins => s.stale_threshold_minutes)`,
        );
        expect(stale).toBeGreaterThan(0);
      });
    },
    SEED_TIMEOUT,
  );
});

describe('FR-DEM-02: forty doctors, realistically Bangladeshi, evening chambers', () => {
  it(
    'writes forty verified doctors covering all eight specialties',
    async () => {
      await seeded(async (client) => {
        expect(await count(client, 'SELECT count(*)::text AS n FROM doctors')).toBe(
          DEMO_DOCTORS.length,
        );
        expect(DEMO_DOCTORS.length).toBe(40);

        // FR-SUP-02: an unverified doctor cannot be published.
        expect(
          await count(
            client,
            'SELECT count(*)::text AS n FROM doctors WHERE bmdc_verified_at IS NULL',
          ),
        ).toBe(0);

        const { rows } = await client.query<{ code: string }>(
          'SELECT DISTINCT code FROM departments ORDER BY code',
        );
        expect(rows.map((row) => row.code).sort()).toEqual(
          SPECIALTIES.map((entry) => entry.code).sort(),
        );
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'charges between 500 and 2,000 BDT, in integer poisha',
    async () => {
      await seeded(async (client) => {
        const { rows } = await client.query<{ min: number; max: number }>(
          'SELECT min(fee_poisha)::int AS min, max(fee_poisha)::int AS max FROM doctor_hospitals',
        );
        // DB-P5: poisha, so 500 BDT is 50000 and 2,000 BDT is 200000.
        expect(rows[0]?.min).toBeGreaterThanOrEqual(50_000);
        expect(rows[0]?.max).toBeLessThanOrEqual(200_000);
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'runs every chamber in the evening, Dhaka time',
    async () => {
      await seeded(async (client) => {
        // The templates carry local wall-clock times (FR-DEM-02: evening chamber
        // hours). Anything starting before 16:00 would be a morning clinic.
        const daytime = await count(
          client,
          `SELECT count(*)::text AS n FROM session_templates WHERE start_time < time '16:00'`,
        );
        expect(daytime).toBe(0);
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'never puts one doctor in two chambers at the same moment',
    async () => {
      await seeded(async (client) => {
        const overlapping = await count(
          client,
          `SELECT count(*)::text AS n
           FROM sessions a
           JOIN sessions b
             ON b.doctor_id = a.doctor_id
            AND b.id <> a.id
            AND b.planned_start < a.planned_end
            AND a.planned_start < b.planned_end`,
        );
        expect(overlapping).toBe(0);
      });
    },
    SEED_TIMEOUT,
  );
});

describe('FR-DEM-03: two hundred profiles and five hundred past visits', () => {
  it(
    'writes the profiles across accounts and guest identities',
    async () => {
      await seeded(async (client) => {
        expect(await count(client, 'SELECT count(*)::text AS n FROM patients')).toBe(PATIENT_COUNT);
        expect(PATIENT_COUNT).toBe(200);
        expect(await count(client, 'SELECT count(*)::text AS n FROM users')).toBe(ACCOUNT_COUNT);
        expect(await count(client, 'SELECT count(*)::text AS n FROM guest_identities')).toBe(
          GUEST_COUNT,
        );

        // patients_one_owner is a check constraint, but a seed that put every
        // profile on an account would satisfy it and still miss FR-GST-04.
        expect(
          await count(
            client,
            'SELECT count(*)::text AS n FROM patients WHERE owner_guest_id IS NOT NULL',
          ),
        ).toBe(GUEST_COUNT);
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'completes five hundred consultations with measured durations',
    async () => {
      await seeded(async (client) => {
        const done = await count(
          client,
          `SELECT count(*)::text AS n
           FROM bookings b JOIN sessions s ON s.id = b.session_id
          WHERE b.status = 'done' AND s.status = 'ended'`,
        );
        expect(done).toBe(HISTORY_VISIT_TARGET);
        expect(HISTORY_VISIT_TARGET).toBe(500);

        // FR-REC-11: measured, never typed. A done booking with no duration
        // would leave the rolling rate (FR-QUE-12) with nothing to learn from.
        const unmeasured = await count(
          client,
          `SELECT count(*)::text AS n FROM bookings WHERE status = 'done' AND consult_seconds IS NULL`,
        );
        expect(unmeasured).toBe(0);
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'gives the history no-shows, so the recovery figure has something to recover',
    async () => {
      await seeded(async (client) => {
        // FR-ADM-03 and FR-QUE-31 are the numbers that make the product's
        // argument; a perfect history has nothing to show.
        expect(
          await count(client, `SELECT count(*)::text AS n FROM bookings WHERE status = 'no_show'`),
        ).toBeGreaterThan(0);
        expect(
          await count(
            client,
            `SELECT count(*)::text AS n FROM bookings WHERE status = 'cancelled'`,
          ),
        ).toBeGreaterThan(0);
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'teaches each doctor a rolling rate from their own history (FR-QUE-12)',
    async () => {
      await seeded(async (client) => {
        const untaught = await count(
          client,
          `SELECT count(*)::text AS n
           FROM sessions WHERE status = 'ended' AND avg_consult_seconds IS NULL`,
        );
        expect(untaught).toBe(0);
      });
    },
    SEED_TIMEOUT,
  );
});

describe('FR-DEM-06: a session mid-queue, ready for the pitch', () => {
  it(
    'opens on the state PRD.md §24 describes',
    async () => {
      await seeded(async (client) => {
        const { rows } = await client.query<{
          id: string;
          status: string;
          now_serving_serial: number;
          waiting_count: number;
          late_count: number;
          done_count: number;
          capacity: number;
        }>(
          `SELECT s.id, s.status, q.now_serving_serial, q.waiting_count,
                q.late_count, q.done_count, s.capacity
           FROM sessions s JOIN queue_state q ON q.session_id = s.id
          WHERE s.status = 'running'`,
        );

        expect(rows).toHaveLength(1);
        const session = rows[0];
        if (session === undefined) throw new Error('no running session');

        // Serials 1…5 seen, 6 in the chamber, 9 late, 7…17 otherwise waiting.
        expect(session.done_count).toBe(DEMO_LIVE.doneThrough);
        expect(session.now_serving_serial).toBe(DEMO_LIVE.doneThrough + 1);
        expect(session.late_count).toBe(1);
        expect(session.waiting_count).toBe(DEMO_LIVE.bookingsBefore - DEMO_LIVE.doneThrough - 2);
        expect(session.capacity).toBe(DEMO_LIVE.capacity);

        // The pitch's first act is a patient booking and being given serial 18.
        const highest = await count(
          client,
          `SELECT coalesce(max(serial_number), 0)::text AS n FROM bookings WHERE session_id = $1`,
          [session.id],
        );
        expect(highest).toBe(DEMO_LIVE.bookingsBefore);
        expect(highest + 1).toBe(18);
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'is live relative to now, whatever hour the reset happened at',
    async () => {
      await seeded(async (client) => {
        const { rows } = await client.query<{ started_minutes_ago: number }>(
          // Cast to double precision: `extract` returns numeric, which pg hands
          // back as a string, and a string compares as neither greater nor less.
          `SELECT (extract(epoch FROM (now() - actual_start)) / 60)::double precision
                  AS started_minutes_ago
           FROM sessions WHERE status = 'running'`,
        );
        const elapsed = rows[0]?.started_minutes_ago ?? 0;

        // Long enough to have seen five patients, recent enough to still be
        // running. Anchored to the seed's own instant, not to 18:00.
        expect(elapsed).toBeGreaterThan(30);
        expect(elapsed).toBeLessThan(180);
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'has a standby list, because the pitch offers a freed slot to it',
    async () => {
      await seeded(async (client) => {
        const standby = await count(
          client,
          `SELECT count(*)::text AS n
           FROM standby_list sl JOIN sessions s ON s.id = sl.session_id
          WHERE s.status = 'running' AND sl.removed_at IS NULL`,
        );
        expect(standby).toBeGreaterThan(0);
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'keeps every projection in step with the log it came from (DB-P1)',
    async () => {
      await seeded(async (client) => {
        // `queue_state` is a cache of the event log and `sessions.last_event_seq`
        // mirrors it. A seed that wrote a plausible cache instead of deriving one
        // would produce a demo that disagrees with itself the moment step 6
        // replays it.
        const disagreeing = await count(
          client,
          `SELECT count(*)::text AS n FROM (
           SELECT s.id
             FROM sessions s
             JOIN queue_events e ON e.session_id = s.id
             JOIN queue_state q ON q.session_id = s.id
            GROUP BY s.id, s.last_event_seq, q.rebuilt_from_seq
           HAVING s.last_event_seq <> max(e.seq) OR q.rebuilt_from_seq <> max(e.seq)
         ) AS mismatched`,
        );
        expect(disagreeing).toBe(0);
      });
    },
    SEED_TIMEOUT,
  );
});

describe('FR-DEM-07: every demo row is visibly labelled', () => {
  it(
    'labels every name a human reads, in both scripts',
    async () => {
      await seeded(async (client) => {
        const unlabelled = await count(
          client,
          `SELECT (
           (SELECT count(*) FROM hospitals WHERE name_en NOT LIKE $1 OR name_bn NOT LIKE $2) +
           (SELECT count(*) FROM doctors   WHERE full_name_en NOT LIKE $1 OR full_name_bn NOT LIKE $2) +
           (SELECT count(*) FROM patients  WHERE full_name NOT LIKE $2) +
           (SELECT count(*) FROM staff_users WHERE full_name NOT LIKE $2) +
           (SELECT count(*) FROM guest_identities WHERE display_name NOT LIKE $2)
         )::text AS n`,
          [`%${DEMO_LABEL_EN}%`, `%${DEMO_LABEL_BN}%`],
        );
        expect(unlabelled).toBe(0);
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'labels the rows that have no name of their own',
    async () => {
      await seeded(async (client) => {
        // A BMDC number no real registration takes, an unroutable email, and a
        // marker in every jsonb column — so a CSV export or a table editor shows
        // what this is without a UI banner to help.
        expect(
          await count(
            client,
            `SELECT count(*)::text AS n FROM doctors WHERE bmdc_number NOT LIKE 'DEMO-%'`,
          ),
        ).toBe(0);
        expect(
          await count(
            client,
            `SELECT count(*)::text AS n FROM staff_users WHERE email NOT LIKE '%.demo.invalid'`,
          ),
        ).toBe(0);
        expect(
          await count(
            client,
            `SELECT count(*)::text AS n FROM bookings WHERE intake->>'demo' IS DISTINCT FROM 'true'`,
          ),
        ).toBe(0);
      });
    },
    SEED_TIMEOUT,
  );
});

describe('FR-SEC-08: no real patient data, ever', () => {
  it(
    'draws every phone number from the synthetic demo block',
    async () => {
      await seeded(async (client) => {
        // +8801 <kind> 0 <six digits>. The zero in that position is what a real
        // allocated Bangladeshi mobile number does not have.
        const outside = await count(
          client,
          `SELECT count(*)::text AS n FROM (
           SELECT phone FROM users
           UNION ALL SELECT phone FROM guest_identities
           UNION ALL SELECT phone FROM patients WHERE phone IS NOT NULL
           UNION ALL SELECT contact_phone FROM standby_list
         ) AS all_numbers
         WHERE phone !~ '^\\+8801[3-9][0-9]0[0-9]{6}$'`,
        );
        expect(outside).toBe(0);
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'stores no national id and no usable credential',
    async () => {
      await seeded(async (client) => {
        expect(
          await count(
            client,
            'SELECT count(*)::text AS n FROM patients WHERE national_id IS NOT NULL',
          ),
        ).toBe(0);

        // CLAUDE.md §4.1: authentication is deferred, so nothing may write a
        // login session and no password_hash may be a hash of anything.
        expect(await count(client, 'SELECT count(*)::text AS n FROM sessions_auth')).toBe(0);
        expect(
          await count(
            client,
            `SELECT count(*)::text AS n FROM staff_users WHERE password_hash NOT LIKE '!disabled:%'`,
          ),
        ).toBe(0);
        expect(
          await count(
            client,
            'SELECT count(*)::text AS n FROM staff_users WHERE totp_secret IS NOT NULL',
          ),
        ).toBe(0);
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'claims no phone verification, because no OTP flow exists',
    async () => {
      await seeded(async (client) => {
        const claimed = await count(
          client,
          `SELECT (
           (SELECT count(*) FROM users WHERE phone_verified_at IS NOT NULL) +
           (SELECT count(*) FROM guest_identities WHERE phone_verified_at IS NOT NULL)
         )::text AS n`,
        );
        expect(claimed).toBe(0);
      });
    },
    SEED_TIMEOUT,
  );
});

describe('the runner reports what it could not do', () => {
  it(
    'skips the modules whose migrations do not exist, and names them',
    async () => {
      await seeded((_client, result) => {
        const skipped = result.results.filter((entry) => !entry.ran);
        expect(skipped.map((entry) => entry.module.name)).toEqual([
          'seed_05_beds',
          'seed_06_ancillary',
        ]);

        // FR-DEM-04 and FR-DEM-05 are not covered in this version, and the run
        // says so rather than producing an empty ward board silently.
        for (const entry of skipped) {
          expect(entry.skippedBecause).toContain('exist yet');
          expect(entry.module.pendingMigration).toMatch(/^00\d\d_/);
        }
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'runs every module whose tables the schema already has',
    async () => {
      await seeded((_client, result) => {
        const ran = result.results.filter((entry) => entry.ran).map((entry) => entry.module.name);
        expect(ran).toEqual([
          'seed_01_hospitals',
          'seed_02_doctors_sessions',
          'seed_03_patients',
          'seed_04_history',
          'seed_07_demo_live',
        ]);
      });
    },
    SEED_TIMEOUT,
  );
});

describe('FR-DEM-06: a reset produces a known state, not merely a plausible one', () => {
  it('draws the same values from the same seed, every time', () => {
    // The demo is asserted on by these tests and demonstrated from a script;
    // both need the same reset to produce the same screen twice. Checked on
    // the generator rather than by seeding twice, which would double the
    // slowest test in the suite to prove the same property.
    //
    // One stream, drawn 200 times — rebuilding the generator on each draw
    // would compare 200 copies of the same first value and prove nothing.
    const draw = (): number[] => {
      const stream = createRng(DEMO_SEED).stream('patients');
      return Array.from({ length: 200 }, () => stream.int(0, 1_000_000));
    };

    expect(draw()).toEqual(draw());
    // …and it is a sequence, not a constant.
    expect(new Set(draw()).size).toBeGreaterThan(150);

    // Labelled streams are independent, so adding a patient cannot change
    // which doctor the pitch session belongs to.
    const root = createRng(DEMO_SEED);
    expect(root.stream('demo-live').int(0, 1_000_000)).not.toBe(
      root.stream('history').int(0, 1_000_000),
    );
  });

  it('declares the pitch session in one place', () => {
    // A test that hard-coded 18 would pass while the seed drifted to 15.
    expect(DEMO_LIVE.bookingsBefore + 1).toBe(18);
    expect(DEMO_FACILITIES.some((entry) => entry.slug === DEMO_LIVE.hospitalSlug)).toBe(true);
    expect(DEMO_DOCTORS.some((entry) => entry.slug === DEMO_LIVE.doctorSlug)).toBe(true);
  });
});
