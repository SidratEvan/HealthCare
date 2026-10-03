/**
 * A ward of fresh beds for the ward board specs.
 *
 * Built from the seeded demo set the way `createConsoleSession` builds a
 * chamber (CLAUDE.md §6): the seeded Shapla General, its seeded ward account,
 * and one new ward whose beds no other spec touches. The ward carries the demo
 * label like every seeded one (`FR-DEM-07`).
 */

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

import { signToken } from '../../backend/api/src/config/jwt.js';

import { E2E_DATABASE_URL, assertLocalDatabase } from './database.js';

assertLocalDatabase();

export interface WardFixture {
  readonly hospitalId: string;
  readonly wardName: string;
  /** Free general beds, in label order. */
  readonly beds: readonly { readonly id: string; readonly label: string }[];
  readonly token: string;
}

async function withClient<T>(body: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    connectionString: E2E_DATABASE_URL,
    options: '-c search_path=public,extensions',
  });
  await client.connect();
  try {
    return await body(client);
  } finally {
    await client.end();
  }
}

/** Four characters, so a bed's label still fits its tile (`E3F9A-01`). */
export function randomTag(): string {
  return randomUUID().slice(0, 4).toUpperCase();
}

/**
 * Inserts the fixture's ward under a name no ward at this hospital holds, and
 * returns the tag it ended up with.
 *
 * A four-character tag is one of 65,536, so two fixtures in one run can pick
 * the same one, and `wards_hospital_name_key` then refuses the second. It
 * happened on the first CI run of this suite (3 October,
 * `ward-board.spec.ts:116`). The spec was not wrong and neither was the
 * product; the fixture was asking for a name that might be taken and calling
 * it an error when it was. A taken name is a reason to pick another.
 */
async function insertWard(
  client: Client,
  hospitalId: string,
  staffId: string,
  nextTag: () => string,
): Promise<{ wardId: string; tag: string }> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tag = nextTag();
    const ward = await client.query<{ id: string }>(
      `INSERT INTO wards (hospital_id, name_bn, name_en, floor, kind, created_by)
       VALUES ($1, $2, $3, 8, 'general', $4)
       ON CONFLICT (hospital_id, name_en) WHERE deleted_at IS NULL DO NOTHING
       RETURNING id`,
      [hospitalId, `ই২ই ওয়ার্ড ${tag} (ডেমো)`, `E2E Ward ${tag} (Demo)`, staffId],
    );
    const wardId = ward.rows[0]?.id;
    if (wardId !== undefined) return { wardId, tag };
  }
  throw new Error(
    'No free ward name in twenty tries: the tag generator is not producing new tags.',
  );
}

export async function createWardFixture(
  size = 3,
  /** Where the ward's tag comes from. A spec passes its own only to prove a clash is survived. */
  nextTag: () => string = randomTag,
): Promise<WardFixture> {
  return await withClient(async (client) => {
    const hospital = await client.query<{ id: string; staff_id: string }>(
      `SELECT h.id, sr.staff_user_id AS staff_id
         FROM hospitals h
         JOIN staff_roles sr ON sr.hospital_id = h.id AND sr.role = 'ward' AND sr.deleted_at IS NULL
        WHERE h.name_en LIKE 'Shapla General Hospital%'
        ORDER BY sr.created_at
        LIMIT 1`,
    );
    const row = hospital.rows[0];
    if (row === undefined) {
      throw new Error(
        'No seeded ward at Shapla General. Run `pnpm db:reset` before `pnpm test:e2e`.',
      );
    }

    const { wardId, tag } = await insertWard(client, row.id, row.staff_id, nextTag);
    const wardName = `ই২ই ওয়ার্ড ${tag} (ডেমো)`;

    const beds: { id: string; label: string }[] = [];
    for (let index = 1; index <= size; index += 1) {
      const label = `E${tag}-${String(index).padStart(2, '0')}`;
      const bed = await client.query<{ id: string }>(
        `INSERT INTO beds (hospital_id, ward_id, label, kind, nightly_poisha, created_by)
         VALUES ($1, $2, $3, 'general', 120000, $4) RETURNING id`,
        [row.id, wardId, label, row.staff_id],
      );
      const id = bed.rows[0]?.id;
      if (id === undefined) throw new Error('bed insert returned no id.');

      // Confirmed a moment ago, so the published figure for general beds is
      // fresh rather than depending on how long ago the suite reset.
      await client.query(
        `INSERT INTO bed_events (hospital_id, bed_id, type, from_state, to_state, actor_staff_id)
         VALUES ($1, $2, 'CLEAN_START', 'free', 'cleaning', $3),
                ($1, $2, 'CLEAN_DONE', 'cleaning', 'free', $3)`,
        [row.id, id, row.staff_id],
      );
      beds.push({ id, label });
    }

    return {
      hospitalId: row.id,
      wardName,
      beds,
      // Under DEMO_MODE the console takes a hospital and a role without a
      // password (CLAUDE.md §4.1); this is that choice, made for the spec.
      token: await signToken({
        kind: 'access',
        claims: { sub: row.staff_id, kind: 'staff', hospitalId: row.id, roles: ['ward'] },
      }),
    };
  });
}

export async function bedState(bedId: string): Promise<string> {
  return await withClient(async (client) => {
    const result = await client.query<{ state: string }>(
      'SELECT state::text AS state FROM beds WHERE id = $1',
      [bedId],
    );
    return result.rows[0]?.state ?? 'missing';
  });
}

export async function admissionsIn(bedId: string): Promise<number> {
  return await withClient(async (client) => {
    const result = await client.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM admissions WHERE bed_id = $1',
      [bedId],
    );
    return Number(result.rows[0]?.n ?? '0');
  });
}
