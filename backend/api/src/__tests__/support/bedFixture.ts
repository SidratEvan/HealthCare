/**
 * A ward of fresh beds at a seeded hospital, for the bed route tests.
 *
 * Built the way `createQueueFixture` builds a chamber: from the seeded demo
 * set (CLAUDE.md §6) — a real facility, its real ward staff account, real
 * seeded patients — plus one new ward whose beds nobody else is using. The API
 * suite shares its database across files, and a test that admitted into a
 * seeded bed would change what the next file counts.
 *
 * The ward carries the demo label like everything else (`FR-DEM-07`).
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';

import type { BedKind } from '@platform/domain';

import { db } from '../../config/db.js';
import { signToken } from '../../config/jwt.js';

import { staffIdFor } from './queueFixture.js';


export interface BedFixture {
  readonly hospitalId: string;
  readonly wardId: string;
  /** Free beds, in label order. */
  readonly bedIds: readonly string[];
  readonly kind: BedKind;
  /** The seeded ward account; `bed_events.actor_staff_id` is a foreign key. */
  readonly wardStaffId: string;
  /** A bearer token for that account. */
  readonly wardToken: string;
  /** A seeded receptionist at the same hospital, for the role matrix. */
  readonly receptionistToken: string;
}

/** The seeded facility the fixtures are built at: it has ward staff and every bed kind. */
async function wardHospital(): Promise<string> {
  const result = await sql<{ id: string }>`
    SELECT h.id FROM hospitals h
     WHERE h.name_en LIKE 'Shapla General Hospital%' AND h.deleted_at IS NULL
     LIMIT 1
  `.execute(db);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('The seed should hold Shapla General (FR-DEM-01).');
  return id;
}

export async function createBedFixture(size = 4, kind: BedKind = 'general'): Promise<BedFixture> {
  const hospitalId = await wardHospital();
  const wardStaffId = await staffIdFor(hospitalId, 'ward');
  const receptionistId = await staffIdFor(hospitalId, 'receptionist');
  const tag = randomUUID().slice(0, 8);

  const ward = await sql<{ id: string }>`
    INSERT INTO wards (hospital_id, name_bn, name_en, floor, kind, created_by)
    VALUES (${hospitalId}::uuid, ${`পরীক্ষা ওয়ার্ড ${tag} (ডেমো)`}, ${`Test Ward ${tag} (Demo)`},
            9, ${kind}::bed_kind, ${wardStaffId}::uuid)
    RETURNING id
  `.execute(db);
  const wardId = ward.rows[0]?.id;
  if (wardId === undefined) throw new Error('ward insert failed');

  const bedIds: string[] = [];
  for (let index = 1; index <= size; index += 1) {
    const bed = await sql<{ id: string }>`
      INSERT INTO beds (hospital_id, ward_id, label, kind, nightly_poisha, created_by)
      VALUES (${hospitalId}::uuid, ${wardId}::uuid, ${`T${tag}-${String(index).padStart(2, '0')}`},
              ${kind}::bed_kind, 150000, ${wardStaffId}::uuid)
      RETURNING id
    `.execute(db);
    const id = bed.rows[0]?.id;
    if (id === undefined) throw new Error('bed insert failed');
    bedIds.push(id);
  }

  return {
    hospitalId,
    wardId,
    bedIds,
    kind,
    wardStaffId,
    wardToken: await tokenFor(wardStaffId, hospitalId, 'ward'),
    receptionistToken: await tokenFor(receptionistId, hospitalId, 'receptionist'),
  };
}

/** A ward account at another hospital, for the cross-hospital scope tests. */
export async function otherWardToken(notThisOne: string): Promise<string> {
  const result = await sql<{ hospital_id: string }>`
    SELECT sr.hospital_id FROM staff_roles sr
     WHERE sr.role = 'ward' AND sr.hospital_id <> ${notThisOne}::uuid AND sr.deleted_at IS NULL
     LIMIT 1
  `.execute(db);
  const hospitalId = result.rows[0]?.hospital_id;
  if (hospitalId === undefined) throw new Error('The seed should staff more than one ward.');
  return await tokenFor(await staffIdFor(hospitalId, 'ward'), hospitalId, 'ward');
}

async function tokenFor(staffId: string, hospitalId: string, role: string): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: { sub: staffId, kind: 'staff', hospitalId, roles: [role] },
  });
}

/** The events a bed has, oldest first. */
export async function bedEventsOf(
  bedId: string,
): Promise<{ type: string; to_state: string; actor_staff_id: string | null }[]> {
  const result = await sql<{ type: string; to_state: string; actor_staff_id: string | null }>`
    SELECT type, to_state::text AS to_state, actor_staff_id
      FROM bed_events WHERE bed_id = ${bedId}::uuid ORDER BY server_ts, id
  `.execute(db);
  return result.rows;
}

let phoneCounter = 0;

/**
 * A person at the ward desk, with a phone number no seeded identity holds.
 *
 * `+88017` followed by the process id and a counter: inside the mobile
 * format `DB-P6` requires, and outside the `+88013…` block the seeds use, so a
 * desk admit in a test creates its own patient rather than finding a seeded
 * one and changing what another file counts.
 */
export function deskPatient(name = 'রফিকুল ইসলাম (ডেমো)'): {
  name: string;
  phone: string;
  ageYears: number;
  sex: 'male';
} {
  phoneCounter += 1;
  const digits = `${String(process.pid % 1000).padStart(3, '0')}${String(phoneCounter).padStart(5, '0')}`;
  return { name, phone: `+88017${digits}`, ageYears: 58, sex: 'male' };
}
