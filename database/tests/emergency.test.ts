/**
 * The emergency tables and `fn_nearby_hospitals` (migrations 0008, 0013, 0016).
 *
 * The same stance as `beds.test.ts`: an ER console is used under more pressure
 * than any other screen in the product, so what an `emergency_cases` row is
 * *allowed to say* is enforced by the database, and each test below attempts
 * something a hurried console could do and requires the schema to refuse it.
 */

import { describe, expect, it } from 'vitest';

import { expectRejection, withRollback } from './support/database.js';
import { insertExtraPatient, insertGraph } from './support/fixtures.js';

import type { Client } from 'pg';

/** Farmgate, Dhaka — between Shapla, Jamuna and Padma. */
const FARMGATE = { lat: 23.758, lng: 90.39 } as const;

type CaseFields = Record<string, string | number | null>;

/**
 * Inserts one case with whatever columns are given, on top of an inbound
 * alert's minimum. Every column is named explicitly so a test reads as the row
 * it is trying to write.
 */
async function insertCase(client: Client, hospitalId: string, fields: CaseFields): Promise<string> {
  const row: CaseFields = {
    hospital_id: hospitalId,
    problem_type: 'burn',
    state: 'inbound',
    inbound_at: new Date().toISOString(),
    ...fields,
  };
  const columns = Object.keys(row);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO emergency_cases (${columns.join(', ')})
     VALUES (${columns.map((_, index) => `$${String(index + 1)}`).join(', ')})
     RETURNING id`,
    columns.map((column) => row[column] ?? null),
  );
  const inserted = rows[0];
  if (inserted === undefined) throw new Error('emergency case insert failed');
  return inserted.id;
}

/** The fields of somebody who has arrived and been given a token. */
function arrived(token: string, extra: CaseFields = {}): CaseFields {
  return {
    state: 'arrived',
    inbound_at: null,
    arrived_at: new Date().toISOString(),
    token_label: token,
    ...extra,
  };
}

async function seededHospital(client: Client, nameEn: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM hospitals WHERE name_en LIKE $1 || '%'`,
    [nameEn],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`No seeded hospital named ${nameEn}.`);
  return row.id;
}

describe('what an emergency case may say (migration 0016)', () => {
  it('takes an alert with nothing but a problem and a time (FR-GST-03)', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const id = await insertCase(client, graph.hospitalId, {});

      const { rows } = await client.query<{ patient_id: string | null; closed_at: Date | null }>(
        'SELECT patient_id, closed_at FROM emergency_cases WHERE id = $1',
        [id],
      );
      expect(rows[0]).toEqual({ patient_id: null, closed_at: null });
    });
  });

  it('refuses a problem type outside FR-PAT-42, and an age nobody is', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      const problem = await expectRejection(client, () =>
        insertCase(client, graph.hospitalId, { problem_type: 'poisoning' }),
      );
      expect(problem.constraint).toBe('emergency_cases_problem_allowed');

      const age = await expectRejection(client, () =>
        insertCase(client, graph.hospitalId, { patient_age_years: 140 }),
      );
      expect(age.constraint).toBe('emergency_cases_age_sane');
    });
  });

  it('stamps each state: announced, acknowledged, arrived', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      const inbound = await expectRejection(client, () =>
        insertCase(client, graph.hospitalId, { inbound_at: null }),
      );
      expect(inbound.constraint).toBe('emergency_cases_inbound_stamped');

      const acknowledged = await expectRejection(client, () =>
        insertCase(client, graph.hospitalId, { state: 'acknowledged' }),
      );
      expect(acknowledged.constraint).toBe('emergency_cases_acknowledged_stamped');

      const arrival = await expectRejection(client, () =>
        insertCase(client, graph.hospitalId, { ...arrived('ER-1'), arrived_at: null }),
      );
      expect(arrival.constraint).toBe('emergency_cases_arrival_stamped');
    });
  });

  it('declines only with a reason, and a reason means declined (FR-EMG-02)', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const closedAt = new Date().toISOString();

      const noReason = await expectRejection(client, () =>
        insertCase(client, graph.hospitalId, { state: 'declined', closed_at: closedAt }),
      );
      expect(noReason.constraint).toBe('emergency_cases_decline_has_reason');

      const blank = await expectRejection(client, () =>
        insertCase(client, graph.hospitalId, {
          state: 'declined',
          closed_at: closedAt,
          decline_reason: '   ',
        }),
      );
      expect(blank.constraint).toBe('emergency_cases_decline_has_reason');

      const strayReason = await expectRejection(client, () =>
        insertCase(client, graph.hospitalId, { decline_reason: 'বার্ন ইউনিট পূর্ণ' }),
      );
      expect(strayReason.constraint).toBe('emergency_cases_decline_has_reason');

      await insertCase(client, graph.hospitalId, {
        state: 'declined',
        closed_at: closedAt,
        decline_reason: 'বার্ন ইউনিট পূর্ণ',
      });
    });
  });

  it('turns nobody away after they have arrived — that is a referral', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const error = await expectRejection(client, () =>
        insertCase(
          client,
          graph.hospitalId,
          arrived('ER-1', {
            state: 'declined',
            decline_reason: 'পূর্ণ',
            closed_at: new Date().toISOString(),
          }),
        ),
      );
      expect(error.constraint).toBe('emergency_cases_turned_away_before_arrival');
    });
  });

  it('is closed exactly when it has left the active set (FR-EMG-04)', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      const openButClosed = await expectRejection(client, () =>
        insertCase(client, graph.hospitalId, { closed_at: new Date().toISOString() }),
      );
      expect(openButClosed.constraint).toBe('emergency_cases_closed_when_final');

      const finalButOpen = await expectRejection(client, () =>
        insertCase(client, graph.hospitalId, arrived('ER-1', { state: 'discharged' })),
      );
      expect(finalButOpen.constraint).toBe('emergency_cases_closed_when_final');
    });
  });

  it('gives a token at the door, and triages only somebody present (FR-EMG-03)', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      const tokenless = await expectRejection(client, () =>
        insertCase(client, graph.hospitalId, arrived('ER-1', { token_label: null })),
      );
      expect(tokenless.constraint).toBe('emergency_cases_arrival_has_token');

      const remote = await expectRejection(client, () =>
        insertCase(client, graph.hospitalId, { triage: 'red' }),
      );
      expect(remote.constraint).toBe('emergency_cases_triage_on_arrival');
    });
  });

  it('hands off to the ward with a kind and a time, only after arrival (BTN-B07-ADMIT)', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const now = new Date().toISOString();

      const half = await expectRejection(client, () =>
        insertCase(client, graph.hospitalId, arrived('ER-1', { admit_bed_kind: 'burn' })),
      );
      expect(half.constraint).toBe('emergency_cases_handoff_complete');

      const early = await expectRejection(client, () =>
        insertCase(client, graph.hospitalId, { admit_bed_kind: 'burn', admit_requested_at: now }),
      );
      expect(early.constraint).toBe('emergency_cases_handoff_after_arrival');

      const unplaced = await expectRejection(client, () =>
        insertCase(
          client,
          graph.hospitalId,
          arrived('ER-1', { state: 'admitted', closed_at: now }),
        ),
      );
      expect(unplaced.constraint).toBe('emergency_cases_admitted_was_handed_off');
    });
  });

  it('calls one person by a token at a time, and lets a closed case keep its number', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const now = new Date().toISOString();

      await insertCase(client, graph.hospitalId, arrived('ER-7'));
      const twice = await expectRejection(client, () =>
        insertCase(client, graph.hospitalId, arrived('ER-7')),
      );
      expect(twice.constraint).toBe('emergency_cases_open_token_key');

      // Yesterday's ER-7 went home; today's ER-7 is somebody else.
      await insertCase(
        client,
        graph.hospitalId,
        arrived('ER-8', { state: 'discharged', closed_at: now }),
      );
      await insertCase(client, graph.hospitalId, arrived('ER-8'));
    });
  });

  it('creates the person once however often the alert is retried', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const key = 'retry-0123456789abcdef';

      await insertCase(client, graph.hospitalId, { idempotency_key: key });
      const retry = await expectRejection(client, () =>
        insertCase(client, graph.hospitalId, { idempotency_key: key }),
      );
      expect(retry.constraint).toBe('emergency_cases_idempotency_key');

      const short = await expectRejection(client, () =>
        insertCase(client, graph.hospitalId, { idempotency_key: 'short' }),
      );
      expect(short.constraint).toBe('emergency_cases_idempotency_key_shape');
    });
  });

  it('links a case to one stay, and only to a stay that came through the ER', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const now = new Date().toISOString();
      const caseId = await insertCase(
        client,
        graph.hospitalId,
        arrived('ER-1', { admit_bed_kind: 'general', admit_requested_at: now }),
      );

      const { rows: wards } = await client.query<{ id: string }>(
        `INSERT INTO wards (hospital_id, name_bn, name_en, floor, kind)
         VALUES ($1, 'ওয়ার্ড (ডেমো)', 'Ward (Demo)', 1, 'general') RETURNING id`,
        [graph.hospitalId],
      );
      const wardId = wards[0]?.id ?? '';
      const bedIds: string[] = [];
      for (const label of ['101', '102']) {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO beds (hospital_id, ward_id, label, kind, nightly_poisha)
           VALUES ($1, $2, $3, 'general', 100000) RETURNING id`,
          [graph.hospitalId, wardId, label],
        );
        bedIds.push(rows[0]?.id ?? '');
      }
      const other = await insertExtraPatient(client, graph.userId);

      const notEr = await expectRejection(client, () =>
        client.query(
          `INSERT INTO admissions (patient_id, hospital_id, bed_id, source, emergency_case_id)
           VALUES ($1, $2, $3, 'opd', $4)`,
          [graph.patientId, graph.hospitalId, bedIds[0], caseId],
        ),
      );
      expect(notEr.constraint).toBe('admissions_case_is_er');

      await client.query(
        `INSERT INTO admissions (patient_id, hospital_id, bed_id, source, emergency_case_id)
         VALUES ($1, $2, $3, 'er', $4)`,
        [graph.patientId, graph.hospitalId, bedIds[0], caseId],
      );
      const secondStay = await expectRejection(client, () =>
        client.query(
          `INSERT INTO admissions (patient_id, hospital_id, bed_id, source, emergency_case_id)
           VALUES ($1, $2, $3, 'er', $4)`,
          [other, graph.hospitalId, bedIds[1], caseId],
        ),
      );
      expect(secondStay.constraint).toBe('admissions_emergency_case_key');
    });
  });
});

describe('the ER load the public is shown (FR-EMG-04)', () => {
  it('counts open cases and nothing that has left', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const now = new Date().toISOString();

      const load = async (): Promise<number> => {
        const { rows } = await client.query<{ er_active: number }>(
          'SELECT er_active FROM v_public_hospital_capacity WHERE hospital_id = $1',
          [graph.hospitalId],
        );
        return rows[0]?.er_active ?? -1;
      };

      expect(await load()).toBe(0);
      await insertCase(client, graph.hospitalId, {});
      await insertCase(client, graph.hospitalId, arrived('ER-1'));
      expect(await load()).toBe(2);

      await insertCase(client, graph.hospitalId, {
        state: 'declined',
        decline_reason: 'পূর্ণ',
        closed_at: now,
      });
      await insertCase(client, graph.hospitalId, { state: 'cancelled', closed_at: now });
      await insertCase(
        client,
        graph.hospitalId,
        arrived('ER-2', { state: 'discharged', closed_at: now }),
      );
      expect(await load()).toBe(2);
    });
  });
});

describe('fn_nearby_hospitals (DATABASE.md §4, FR-PAT-43)', () => {
  interface Nearby {
    name_en: string;
    distance_m: number;
    has_capability: boolean | null;
  }

  async function nearby(
    client: Client,
    capability: string | null,
    radiusMetres = 50_000,
  ): Promise<Nearby[]> {
    const { rows } = await client.query<Nearby>(
      `SELECT h.name_en, n.distance_m, n.has_capability
         FROM fn_nearby_hospitals($1, $2, $3::capability_kind, $4) n
         JOIN hospitals h ON h.id = n.hospital_id
        WHERE h.name_en LIKE '%(Demo)'`,
      [FARMGATE.lat, FARMGATE.lng, capability, radiusMetres],
    );
    return rows;
  }

  it('returns the facilities within the radius, nearest first', async () => {
    await withRollback(async (client) => {
      const rows = await nearby(client, 'burn_unit');
      const names = rows.map((row) => row.name_en.replace(' (Demo)', ''));

      // Chattogram is two hundred kilometres away: outside, not last.
      expect(names).not.toContain('Karnaphuli General Hospital');
      expect(names.slice(0, 2)).toEqual([
        'Shapla General Hospital',
        'Jamuna Medical College Hospital',
      ]);
      const distances = rows.map((row) => row.distance_m);
      expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    });
  });

  it('says which can take the case now, without leaving out those that cannot', async () => {
    await withRollback(async (client) => {
      const burn = new Map(
        (await nearby(client, 'burn_unit')).map((row) => [row.name_en, row.has_capability]),
      );
      expect(burn.get('Padma Specialised Hospital (Demo)')).toBe(true);
      expect(burn.get('Jamuna Medical College Hospital (Demo)')).toBe(true);
      expect(burn.get('Shapla General Hospital (Demo)')).toBe(false);

      // Jamuna has a cath lab, but it is down (seed_01): available is the
      // operational fact, not the building's inventory (FR-EMG-05).
      const cathLab = new Map(
        (await nearby(client, 'cath_lab')).map((row) => [row.name_en, row.has_capability]),
      );
      expect(cathLab.get('Jamuna Medical College Hospital (Demo)')).toBe(false);
      expect(cathLab.get('Shapla General Hospital (Demo)')).toBe(true);
    });
  });

  it('answers null, not false, when no capability was asked for', async () => {
    await withRollback(async (client) => {
      const rows = await nearby(client, null);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.has_capability === null)).toBe(true);
    });
  });

  it('leaves out a facility that is not live', async () => {
    await withRollback(async (client) => {
      const jamuna = await seededHospital(client, 'Jamuna');
      await client.query('UPDATE hospitals SET is_live = false WHERE id = $1', [jamuna]);

      const names = (await nearby(client, 'burn_unit')).map((row) => row.name_en);
      expect(names).not.toContain('Jamuna Medical College Hospital (Demo)');
    });
  });
});
