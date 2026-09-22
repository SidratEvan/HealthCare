/**
 * The bed tables and the public capacity view (migrations 0008, 0012).
 *
 * `PRD.md` §3.2: "A wrong 'bed available' can kill someone." So these tests
 * are about what a bed row is *allowed to say* — each one attempts something a
 * hurried ward console could do and requires the database, not the
 * application, to refuse it — and about what the public is told as a result.
 */

import { describe, expect, it } from 'vitest';

import { labelBn, labelEn } from '../seeds/lib/demo.js';

import { expectRejection, withRollback } from './support/database.js';
import { insertExtraPatient, insertGraph } from './support/fixtures.js';

import type { Client } from 'pg';

/** A ward at the graph's hospital. */
async function insertWard(
  client: Client,
  hospitalId: string,
  kind = 'general',
  name = 'Ward',
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO wards (hospital_id, name_bn, name_en, floor, kind)
     VALUES ($1, $2, $3, 3, $4::bed_kind) RETURNING id`,
    [hospitalId, labelBn(`${name} ওয়ার্ড`), labelEn(name), kind],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('ward insert failed');
  return row.id;
}

/** A free bed. */
async function insertBed(
  client: Client,
  input: { hospitalId: string; wardId: string; label: string; kind?: string; nightly?: number },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO beds (hospital_id, ward_id, label, kind, nightly_poisha)
     VALUES ($1, $2, $3, $4::bed_kind, $5) RETURNING id`,
    [
      input.hospitalId,
      input.wardId,
      input.label,
      input.kind ?? 'general',
      input.nightly ?? 120_000,
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('bed insert failed');
  return row.id;
}

/** An open admission into a bed, with the bed flipped to occupied. */
async function admit(
  client: Client,
  input: { hospitalId: string; bedId: string; patientId: string },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO admissions (patient_id, hospital_id, bed_id, source)
     VALUES ($1, $2, $3, 'opd') RETURNING id`,
    [input.patientId, input.hospitalId, input.bedId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('admission insert failed');
  await client.query(
    `UPDATE beds SET state = 'occupied', current_admission_id = $2 WHERE id = $1`,
    [input.bedId, row.id],
  );
  return row.id;
}

/** Appends one bed event. */
async function bedEvent(
  client: Client,
  input: {
    hospitalId: string;
    bedId: string;
    staffUserId: string | null;
    type: string;
    from: string;
    to: string;
    admissionId?: string | null;
    at?: string;
  },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO bed_events
       (hospital_id, bed_id, type, from_state, to_state, admission_id, actor_staff_id, server_ts)
     VALUES ($1, $2, $3, $4::bed_state, $5::bed_state, $6, $7, coalesce($8::timestamptz, now()))
     RETURNING id`,
    [
      input.hospitalId,
      input.bedId,
      input.type,
      input.from,
      input.to,
      input.admissionId ?? null,
      input.staffUserId,
      input.at ?? null,
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('bed event insert failed');
  return row.id;
}

interface CapacityRow {
  bed_total: number;
  bed_free: number;
  icu_total: number | null;
  icu_free: number | null;
  beds_as_of: Date | null;
  by_kind: {
    kind: string;
    total: number;
    free: number;
    nightlyMinPoisha: number | null;
    nightlyMaxPoisha: number | null;
    asOf: string | null;
  }[];
}

async function capacity(client: Client, hospitalId: string): Promise<CapacityRow> {
  const { rows } = await client.query<CapacityRow>(
    `SELECT bed_total, bed_free, icu_total, icu_free, beds_as_of, by_kind
       FROM v_public_hospital_capacity WHERE hospital_id = $1`,
    [hospitalId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('no capacity row');
  return row;
}

describe('bed_events is append-only (DATABASE.md §2.5)', () => {
  it('accepts an append, and refuses UPDATE, DELETE and TRUNCATE', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const ward = await insertWard(client, graph.hospitalId);
      const bed = await insertBed(client, {
        hospitalId: graph.hospitalId,
        wardId: ward,
        label: '301',
      });

      const event = await bedEvent(client, {
        hospitalId: graph.hospitalId,
        bedId: bed,
        staffUserId: graph.staffUserId,
        type: 'OOS',
        from: 'free',
        to: 'out_of_service',
      });

      const updated = await expectRejection(client, () =>
        client.query(`UPDATE bed_events SET payload = '{"x":1}'::jsonb WHERE id = $1`, [event]),
      );
      expect(updated.message).toContain('append-only');

      const deleted = await expectRejection(client, () =>
        client.query('DELETE FROM bed_events WHERE id = $1', [event]),
      );
      expect(deleted.message).toContain('append-only');

      const truncated = await expectRejection(client, () =>
        client.query('TRUNCATE bed_events CASCADE'),
      );
      expect(truncated.message).toContain('TRUNCATE is not permitted');
    });
  });

  it('refuses an event whose type and outcome disagree', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const ward = await insertWard(client, graph.hospitalId);
      const bed = await insertBed(client, {
        hospitalId: graph.hospitalId,
        wardId: ward,
        label: '301',
      });

      // A clean that ends in an occupied bed has put somebody in it without
      // an admission — the one outcome that must go through ADMIT.
      const error = await expectRejection(client, () =>
        bedEvent(client, {
          hospitalId: graph.hospitalId,
          bedId: bed,
          staffUserId: graph.staffUserId,
          type: 'CLEAN_DONE',
          from: 'cleaning',
          to: 'occupied',
        }),
      );
      expect(error.constraint).toBe('bed_events_type_matches_outcome');
    });
  });

  it('refuses an unattributed change, except a lapsed hold', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const ward = await insertWard(client, graph.hospitalId);
      const bed = await insertBed(client, {
        hospitalId: graph.hospitalId,
        wardId: ward,
        label: '301',
      });

      const error = await expectRejection(client, () =>
        bedEvent(client, {
          hospitalId: graph.hospitalId,
          bedId: bed,
          staffUserId: null,
          type: 'OOS',
          from: 'free',
          to: 'out_of_service',
        }),
      );
      expect(error.constraint).toBe('bed_events_attributed');

      await bedEvent(client, {
        hospitalId: graph.hospitalId,
        bedId: bed,
        staffUserId: null,
        type: 'RELEASE',
        from: 'reserved',
        to: 'free',
      });
    });
  });
});

describe('what a bed row may say (FR-BED-01)', () => {
  it('an occupied bed names its admission, and a free one names none', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const ward = await insertWard(client, graph.hospitalId);
      const bed = await insertBed(client, {
        hospitalId: graph.hospitalId,
        wardId: ward,
        label: '301',
      });

      const error = await expectRejection(client, () =>
        client.query(`UPDATE beds SET state = 'occupied' WHERE id = $1`, [bed]),
      );
      expect(error.constraint).toBe('beds_occupied_has_admission');
    });
  });

  it('a reserved bed says until when, and a bed out of service says why', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const ward = await insertWard(client, graph.hospitalId);
      const bed = await insertBed(client, {
        hospitalId: graph.hospitalId,
        wardId: ward,
        label: '301',
      });

      const reserved = await expectRejection(client, () =>
        client.query(`UPDATE beds SET state = 'reserved' WHERE id = $1`, [bed]),
      );
      expect(reserved.constraint).toBe('beds_reserved_has_expiry');

      const oos = await expectRejection(client, () =>
        client.query(`UPDATE beds SET state = 'out_of_service', oos_reason = '  ' WHERE id = $1`, [
          bed,
        ]),
      );
      expect(oos.constraint).toBe('beds_oos_has_reason');
    });
  });

  it('cannot be filed in a ward of another hospital', async () => {
    await withRollback(async (client) => {
      const first = await insertGraph(client, 1);
      const second = await insertGraph(client, 2);
      const foreignWard = await insertWard(client, second.hospitalId);

      const error = await expectRejection(client, () =>
        insertBed(client, { hospitalId: first.hospitalId, wardId: foreignWard, label: '301' }),
      );
      expect(error.constraint).toBe('beds_ward_same_hospital');
    });
  });

  it('holds one person per bed, and one bed per person', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const ward = await insertWard(client, graph.hospitalId);
      const first = await insertBed(client, {
        hospitalId: graph.hospitalId,
        wardId: ward,
        label: '301',
      });
      const second = await insertBed(client, {
        hospitalId: graph.hospitalId,
        wardId: ward,
        label: '302',
      });
      const other = await insertExtraPatient(client, graph.userId);

      await admit(client, {
        hospitalId: graph.hospitalId,
        bedId: first,
        patientId: graph.patientId,
      });

      const twoInOneBed = await expectRejection(client, () =>
        client.query(
          `INSERT INTO admissions (patient_id, hospital_id, bed_id, source) VALUES ($1, $2, $3, 'opd')`,
          [other, graph.hospitalId, first],
        ),
      );
      expect(twoInOneBed.constraint).toBe('admissions_one_per_bed_key');

      const oneInTwoBeds = await expectRejection(client, () =>
        client.query(
          `INSERT INTO admissions (patient_id, hospital_id, bed_id, source) VALUES ($1, $2, $3, 'opd')`,
          [graph.patientId, graph.hospitalId, second],
        ),
      );
      expect(oneInTwoBeds.constraint).toBe('admissions_one_per_patient_key');
    });
  });

  it('a held bed request names the bed and the deadline', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      const error = await expectRejection(client, () =>
        client.query(
          `INSERT INTO bed_requests
             (hospital_id, patient_id, bed_kind, requested_by_user_id, state, responded_at)
           VALUES ($1, $2, 'icu', $3, 'held', now())`,
          [graph.hospitalId, graph.patientId, graph.userId],
        ),
      );
      expect(error.constraint).toBe('bed_requests_hold_is_a_bed');
    });
  });
});

describe('v_public_hospital_capacity (FR-PAT-14, FR-PAT-51, FR-BED-05)', () => {
  it('counts free beds by kind, and leaves out a bed that cannot be used', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const ward = await insertWard(client, graph.hospitalId);
      const beds = [];
      for (const label of ['301', '302', '303']) {
        beds.push(await insertBed(client, { hospitalId: graph.hospitalId, wardId: ward, label }));
      }
      const [occupied, broken] = beds;
      if (occupied === undefined || broken === undefined) throw new Error('beds missing');

      await admit(client, {
        hospitalId: graph.hospitalId,
        bedId: occupied,
        patientId: graph.patientId,
      });
      await client.query(
        `UPDATE beds SET state = 'out_of_service', oos_reason = 'oxygen line' WHERE id = $1`,
        [broken],
      );

      const row = await capacity(client, graph.hospitalId);

      // Three beds, one broken: two in service, one of them free.
      expect(row.bed_total).toBe(2);
      expect(row.bed_free).toBe(1);
      expect(row.by_kind).toEqual([
        expect.objectContaining({ kind: 'general', total: 2, free: 1, nightlyMinPoisha: 120_000 }),
      ]);
    });
  });

  it('treats a lapsed hold as free, before anything has written the release', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const ward = await insertWard(client, graph.hospitalId, 'icu', 'ICU');
      const live = await insertBed(client, {
        hospitalId: graph.hospitalId,
        wardId: ward,
        label: 'ICU-1',
        kind: 'icu',
      });
      const lapsed = await insertBed(client, {
        hospitalId: graph.hospitalId,
        wardId: ward,
        label: 'ICU-2',
        kind: 'icu',
      });

      await client.query(
        `UPDATE beds SET state = 'reserved', reserved_until = now() + interval '1 hour' WHERE id = $1`,
        [live],
      );
      await client.query(
        `UPDATE beds SET state = 'reserved', reserved_until = now() - interval '1 minute' WHERE id = $1`,
        [lapsed],
      );

      const row = await capacity(client, graph.hospitalId);
      expect(row.icu_total).toBe(2);
      expect(row.icu_free).toBe(1);
    });
  });

  it('says "no ICU" as null, not as zero free', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const ward = await insertWard(client, graph.hospitalId);
      await insertBed(client, { hospitalId: graph.hospitalId, wardId: ward, label: '301' });

      const row = await capacity(client, graph.hospitalId);
      expect(row.icu_total).toBeNull();
      expect(row.icu_free).toBeNull();
    });
  });

  it('tells "no beds here" apart from "none free"', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      const row = await capacity(client, graph.hospitalId);
      expect(row.bed_total).toBe(0);
      expect(row.by_kind).toEqual([]);
      expect(row.beds_as_of).toBeNull();
    });
  });

  it('dates each kind by its newest event, and the total by the oldest kind', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const general = await insertWard(client, graph.hospitalId);
      const icu = await insertWard(client, graph.hospitalId, 'icu', 'ICU');
      const ward = await insertBed(client, {
        hospitalId: graph.hospitalId,
        wardId: general,
        label: '301',
      });
      const icuBed = await insertBed(client, {
        hospitalId: graph.hospitalId,
        wardId: icu,
        label: 'ICU-1',
        kind: 'icu',
      });

      // A kind nobody has ever confirmed makes the whole total unconfirmed.
      await bedEvent(client, {
        hospitalId: graph.hospitalId,
        bedId: ward,
        staffUserId: graph.staffUserId,
        type: 'CLEAN_START',
        from: 'free',
        to: 'cleaning',
        at: '2026-09-21T09:00:00Z',
      });
      expect((await capacity(client, graph.hospitalId)).beds_as_of).toBeNull();

      await bedEvent(client, {
        hospitalId: graph.hospitalId,
        bedId: icuBed,
        staffUserId: graph.staffUserId,
        type: 'OOS',
        from: 'free',
        to: 'out_of_service',
        at: '2026-09-21T04:00:00Z',
      });

      const row = await capacity(client, graph.hospitalId);
      expect(row.beds_as_of?.toISOString()).toBe('2026-09-21T04:00:00.000Z');
      const byKind = new Map(row.by_kind.map((entry) => [entry.kind, entry]));
      expect(new Date(byKind.get('general')?.asOf ?? '').toISOString()).toBe(
        '2026-09-21T09:00:00.000Z',
      );
    });
  });
});
