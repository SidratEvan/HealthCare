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
  DEMO_BED_REQUESTS,
  DEMO_DOCTORS,
  DEMO_FACILITIES,
  DEMO_WARDS,
  DEMO_LABEL_BN,
  DEMO_LABEL_EN,
  DEMO_LIVE,
  DEMO_SEED,
  GUEST_COUNT,
  HISTORY_VISIT_TARGET,
  PATIENT_COUNT,
  SEED_MODULES,
  SPECIALTIES,
  doctor,
  facility,
} from '../seeds/index.js';
import { labelEn } from '../seeds/lib/demo.js';
import { tableExists } from '../seeds/lib/insert.js';
import { createRng } from '../seeds/lib/random.js';

import { connect } from './support/database.js';

import type { Client } from 'pg';

/**
 * Reads the seeded demo data.
 *
 * The seed is run once, committed, by the suite's global setup — so these are
 * assertions about the database a developer and the API tests actually share,
 * not about a transaction that existed for the length of one test. Nothing
 * here writes, so nothing needs rolling back.
 */
async function seeded<T>(body: (client: Client) => T | Promise<T>): Promise<T> {
  const client = await connect();
  try {
    return await body(client);
  } finally {
    await client.end();
  }
}

/** `count(*)` as a number, because pg returns bigint as a string. */
async function count(client: Client, sql: string, values: unknown[] = []): Promise<number> {
  const { rows } = await client.query<{ n: string }>(sql, values);
  return Number(rows[0]?.n ?? '0');
}

// The full seed writes a few thousand rows over a few hundred statements.
const SEED_TIMEOUT = 180_000;

/**
 * The doctor and facility the pitch session belongs to, read from the declared
 * demo set rather than written out here.
 *
 * Every query about that session matches on these. The test database is shared
 * with the API suite, which creates sessions of its own, so "the running
 * session" is not a thing a query can ask for.
 */
const PITCH_DOCTOR = doctor(DEMO_LIVE.doctorSlug).nameEn;
const PITCH_FACILITY = facility(DEMO_LIVE.hospitalSlug).nameEn;

describe('FR-DEM-01: six facilities, of the kinds the requirement names', () => {
  it(
    'writes exactly the declared demo set',
    async () => {
      await seeded(async (client) => {
        // Scoped to the declared names rather than reading the whole table.
        // This database is shared: the graph fixture in `seeds/graph.ts`
        // inserts a facility of its own, so `SELECT * FROM hospitals` counts
        // six or seven depending on which file vitest happened to run first.
        // That is order-dependence, which is the flakiness CLAUDE.md §6 calls
        // a bug — and it says nothing about whether the seed is correct.
        const { rows } = await client.query<{ kind: string; district: string; name_en: string }>(
          'SELECT kind, district, name_en FROM hospitals WHERE name_en = ANY($1) ORDER BY name_en',
          [DEMO_FACILITIES.map((entry) => labelEn(entry.nameEn))],
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
        // Identified by the declared demo doctor and facility rather than as
        // "the only running session": this database is shared with the API
        // suite, which creates and drives sessions of its own, so a bare count
        // would pass or fail depending on which suite ran first.
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
             FROM sessions s
             JOIN queue_state q ON q.session_id = s.id
             JOIN doctors d     ON d.id = s.doctor_id
             JOIN hospitals h   ON h.id = s.hospital_id
            WHERE s.status = 'running' AND d.full_name_en LIKE $1 AND h.name_en LIKE $2`,
          [`${PITCH_DOCTOR}%`, `${PITCH_FACILITY}%`],
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
          `SELECT (extract(epoch FROM (now() - s.actual_start)) / 60)::double precision
                    AS started_minutes_ago
             FROM sessions s
             JOIN doctors d ON d.id = s.doctor_id
            WHERE s.status = 'running' AND d.full_name_en LIKE $1`,
          [`${PITCH_DOCTOR}%`],
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
             FROM standby_list sl
             JOIN sessions s ON s.id = sl.session_id
             JOIN doctors d  ON d.id = s.doctor_id
            WHERE d.full_name_en LIKE $1 AND sl.removed_at IS NULL`,
          [`${PITCH_DOCTOR}%`],
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

describe('FR-DEM-04 — bed inventory across wards with live occupancy', () => {
  /** The public row for one declared facility. */
  async function publicRow(
    client: Client,
    slug: string,
  ): Promise<{
    bed_total: number;
    icu_total: number | null;
    icu_free: number | null;
    by_kind: { kind: string; free: number; asOf: string | null }[];
  }> {
    const { rows } = await client.query<{
      bed_total: number;
      icu_total: number | null;
      icu_free: number | null;
      by_kind: { kind: string; free: number; asOf: string | null }[];
    }>(
      `SELECT v.bed_total, v.icu_total, v.icu_free, v.by_kind
         FROM v_public_hospital_capacity v
         JOIN hospitals h ON h.id = v.hospital_id
        WHERE h.name_en = $1`,
      [labelEn(facility(slug).nameEn)],
    );
    const row = rows[0];
    if (row === undefined) throw new Error(`No capacity row for ${slug}`);
    return row;
  }

  it('puts ICU wards at exactly the three facilities marked hasIcu, and burn units at the two with a burn capability', () => {
    const icu = new Set(DEMO_WARDS.filter((ward) => ward.kind === 'icu').map((w) => w.facility));
    const burn = new Set(DEMO_WARDS.filter((ward) => ward.kind === 'burn').map((w) => w.facility));

    expect([...icu].sort()).toEqual(
      DEMO_FACILITIES.filter((f) => f.hasIcu)
        .map((f) => f.slug)
        .sort(),
    );
    expect(icu.size).toBe(3);
    expect([...burn].sort()).toEqual(
      DEMO_FACILITIES.filter((f) => f.capabilities.includes('burn_unit'))
        .map((f) => f.slug)
        .sort(),
    );
    expect(burn.size).toBe(2);
  });

  it(
    'writes every declared ward and bed, each ward name labelled as demo',
    async () => {
      await seeded(async (client) => {
        const declaredBeds = DEMO_WARDS.reduce((sum, ward) => sum + ward.beds, 0);
        expect(await count(client, 'SELECT count(*)::text AS n FROM wards')).toBe(
          DEMO_WARDS.length,
        );
        expect(await count(client, 'SELECT count(*)::text AS n FROM beds')).toBe(declaredBeds);
        expect(
          await count(
            client,
            'SELECT count(*)::text AS n FROM wards WHERE name_bn NOT LIKE $1 OR name_en NOT LIKE $2',
            [`%${DEMO_LABEL_BN}%`, `%${DEMO_LABEL_EN}%`],
          ),
        ).toBe(0);
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'agrees with itself: every bed ends its history in the state it is in',
    async () => {
      await seeded(async (client) => {
        const disagreeing = await count(
          client,
          `SELECT count(*)::text AS n
             FROM beds b
             LEFT JOIN LATERAL (
               SELECT e.to_state FROM bed_events e
                WHERE e.bed_id = b.id ORDER BY e.server_ts DESC, e.id DESC LIMIT 1
             ) last ON true
            WHERE last.to_state IS DISTINCT FROM b.state`,
        );
        expect(disagreeing).toBe(0);

        // An occupied bed names an open admission that names it back.
        const orphaned = await count(
          client,
          `SELECT count(*)::text AS n
             FROM beds b
             LEFT JOIN admissions a ON a.id = b.current_admission_id
            WHERE b.state = 'occupied'
              AND (a.id IS NULL OR a.bed_id <> b.id OR a.discharged_at IS NOT NULL)`,
        );
        expect(orphaned).toBe(0);

        const declaredOccupied = DEMO_WARDS.reduce((sum, ward) => sum + ward.occupied, 0);
        expect(
          await count(client, `SELECT count(*)::text AS n FROM beds WHERE state = 'occupied'`),
        ).toBe(declaredOccupied);
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'says "no inpatient beds" for the diagnostic centre and the clinic',
    async () => {
      await seeded(async (client) => {
        for (const slug of ['meghna-diagnostic', 'buriganga-clinic']) {
          const row = await publicRow(client, slug);
          expect(row.bed_total).toBe(0);
          expect(row.by_kind).toEqual([]);
          expect(row.icu_total).toBeNull();
        }
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'stages the burn scenario: Padma has one fresh free burn bed, Jamuna two stale ones (PRD.md §24 step 7)',
    async () => {
      await seeded(async (client) => {
        const ageMinutes = (asOf: string | null): number =>
          asOf === null ? Number.POSITIVE_INFINITY : (Date.now() - Date.parse(asOf)) / 60_000;

        const padma = (await publicRow(client, 'padma-specialised')).by_kind.find(
          (entry) => entry.kind === 'burn',
        );
        const jamuna = (await publicRow(client, 'jamuna-medical-college')).by_kind.find(
          (entry) => entry.kind === 'burn',
        );

        expect(padma?.free).toBe(1);
        expect(jamuna?.free).toBe(2);
        // Measured against when the suite seeded, so only the ordering and the
        // gap are asserted: Padma minutes old, Jamuna hours.
        expect(ageMinutes(padma?.asOf ?? null)).toBeLessThan(ageMinutes(jamuna?.asOf ?? null));
        expect(ageMinutes(jamuna?.asOf ?? null) - ageMinutes(padma?.asOf ?? null)).toBeGreaterThan(
          180,
        );
      });
    },
    SEED_TIMEOUT,
  );

  it(
    "reports Padma's ICU as full, not unknown",
    async () => {
      await seeded(async (client) => {
        const padma = await publicRow(client, 'padma-specialised');
        expect(padma.icu_total).toBe(8);
        expect(padma.icu_free).toBe(0);
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'opens the pending list on the declared requests, the held one holding a real bed',
    async () => {
      await seeded(async (client) => {
        expect(
          await count(
            client,
            `SELECT count(*)::text AS n FROM bed_requests WHERE state IN ('requested', 'held')`,
          ),
        ).toBe(DEMO_BED_REQUESTS.length);

        const mismatched = await count(
          client,
          `SELECT count(*)::text AS n
             FROM bed_requests r
             JOIN beds b ON b.id = r.bed_id
            WHERE r.state = 'held'
              AND (b.state <> 'reserved' OR b.reserved_until IS DISTINCT FROM r.hold_expires_at)`,
        );
        expect(mismatched).toBe(0);

        // A family asking for a bed is never somebody already lying in one.
        const alreadyIn = await count(
          client,
          `SELECT count(*)::text AS n
             FROM bed_requests r
             JOIN admissions a ON a.patient_id = r.patient_id AND a.discharged_at IS NULL`,
        );
        expect(alreadyIn).toBe(0);
      });
    },
    SEED_TIMEOUT,
  );
});

describe('the runner reports what it could not do', () => {
  it('declares which migration each unbuildable module is waiting for', () => {
    // FR-DEM-05 is not covered in this version. The module exists and says
    // so; the runner checks its tables before calling it and skips with the
    // migration named, rather than producing an empty screen silently.
    // Asserted on the declarations and the live schema, since the seed run
    // itself happened in global setup. `seed_05_beds` left this list at step
    // 14, when migration 0008 gave it tables to write.
    const pending = SEED_MODULES.filter((module) => module.pendingMigration !== undefined);
    expect(pending.map((module) => module.name)).toEqual(['seed_06_ancillary']);

    for (const module of pending) {
      expect(module.pendingMigration).toMatch(/^00\d\d_/);
      expect(module.deferred?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it(
    'is waiting on tables that genuinely do not exist yet',
    async () => {
      await seeded(async (client) => {
        for (const module of SEED_MODULES) {
          if (module.pendingMigration === undefined) continue;
          for (const table of module.writes) {
            // If one of these ever appears, the module is no longer pending and
            // its body has to be written — which is exactly the failure wanted.
            expect(await tableExists(client, table)).toBe(false);
          }
        }
      });
    },
    SEED_TIMEOUT,
  );

  it(
    'ran every module whose tables the schema already has',
    async () => {
      await seeded(async (client) => {
        // The proof that they ran is the rows they wrote.
        for (const table of ['hospitals', 'doctors', 'patients', 'bookings', 'queue_events']) {
          expect(await count(client, `SELECT count(*)::text AS n FROM ${table}`)).toBeGreaterThan(
            0,
          );
        }
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
