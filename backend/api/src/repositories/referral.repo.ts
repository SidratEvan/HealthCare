/**
 * Referrals between ERs (DATABASE.md §2.5; migrations 0008, 0017;
 * `FR-EMG-07..09`).
 *
 * The only place referral SQL lives (CLAUDE.md §7). The rules `emergency.repo`
 * follows hold here too:
 *
 * **A referral is written under a lock the service took.** `lockReferral` is
 * `FOR UPDATE OF r`; the receiving ER accepting and the sending ER withdrawing
 * at the same moment serialise on the row, and the second decides against what
 * the first wrote.
 *
 * **Nothing read here names anybody.** A referral is what the case says —
 * problem, colour, age, sex — a short note, and the two facilities with their
 * ER desks' numbers. No patient, no family's phone. So neither consoles' lists
 * nor the broadcasts carrying them are identifying reads (`DB-P7`).
 */

import { sql } from 'kysely';

import type {
  BedKind,
  CapabilityKind,
  DhakaDate,
  ReferralState,
  ReferralSummary,
  ReferralView,
  Timestamp,
} from '@platform/domain';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

interface ReferralSqlRow {
  id: string;
  state: ReferralState;
  emergency_case_id: string | null;
  arrived_case_id: string | null;
  required_capability: CapabilityKind | null;
  required_bed_kind: BedKind | null;
  summary: Partial<ReferralSummary>;
  sent_at: Date;
  seen_at: Date | null;
  responded_at: Date | null;
  arrived_at: Date | null;
  closed_at: Date | null;
  decline_reason: string | null;
  from_hospital_id: string;
  from_name_bn: string;
  from_name_en: string;
  from_phone: string | null;
  to_hospital_id: string;
  to_name_bn: string;
  to_name_en: string;
  to_phone: string | null;
  from_token_label: string | null;
  arrived_token_label: string | null;
}

const REFERRAL_SELECT = sql`
  SELECT r.id, r.state::text AS state, r.emergency_case_id, r.arrived_case_id,
         r.required_capability::text AS required_capability,
         r.required_bed_kind::text AS required_bed_kind, r.summary,
         r.sent_at, r.seen_at, r.responded_at, r.arrived_at, r.closed_at, r.decline_reason,
         r.from_hospital_id, fh.name_bn AS from_name_bn, fh.name_en AS from_name_en,
         COALESCE(fh.emergency_phone, fh.phone) AS from_phone,
         r.to_hospital_id, th.name_bn AS to_name_bn, th.name_en AS to_name_en,
         COALESCE(th.emergency_phone, th.phone) AS to_phone,
         fc.token_label AS from_token_label, ac.token_label AS arrived_token_label
    FROM referrals r
    JOIN hospitals fh ON fh.id = r.from_hospital_id
    JOIN hospitals th ON th.id = r.to_hospital_id
    LEFT JOIN emergency_cases fc ON fc.id = r.emergency_case_id
    LEFT JOIN emergency_cases ac ON ac.id = r.arrived_case_id
`;

function toView(row: ReferralSqlRow): ReferralView {
  return {
    id: row.id,
    from: {
      hospitalId: row.from_hospital_id,
      nameBn: row.from_name_bn,
      nameEn: row.from_name_en,
      phone: row.from_phone,
    },
    to: {
      hospitalId: row.to_hospital_id,
      nameBn: row.to_name_bn,
      nameEn: row.to_name_en,
      phone: row.to_phone,
    },
    emergencyCaseId: row.emergency_case_id,
    fromTokenLabel: row.from_token_label,
    arrivedCaseId: row.arrived_case_id,
    arrivedTokenLabel: row.arrived_token_label,
    requiredCapability: row.required_capability,
    requiredBedKind: row.required_bed_kind,
    summary: {
      // Written by `insertReferral` alone, so the shape is this file's own.
      problem: row.summary.problem ?? 'other',
      triage: row.summary.triage ?? null,
      ageYears: row.summary.ageYears ?? null,
      sex: row.summary.sex ?? null,
      note: row.summary.note ?? null,
    },
    state: row.state,
    sentAt: row.sent_at.toISOString() as Timestamp,
    seenAt: iso(row.seen_at),
    respondedAt: iso(row.responded_at),
    arrivedAt: iso(row.arrived_at),
    closedAt: iso(row.closed_at),
    declineReason: row.decline_reason,
  };
}

export async function findReferral(referralId: string, trx?: Tx): Promise<ReferralView | null> {
  const result = await sql<ReferralSqlRow>`
    ${REFERRAL_SELECT}
     WHERE r.id = ${referralId}::uuid AND r.deleted_at IS NULL
  `.execute(trx ?? db);
  const row = result.rows[0];
  return row === undefined ? null : toView(row);
}

export async function lockReferral(trx: Tx, referralId: string): Promise<ReferralView | null> {
  const result = await sql<ReferralSqlRow>`
    ${REFERRAL_SELECT}
     WHERE r.id = ${referralId}::uuid AND r.deleted_at IS NULL
       FOR UPDATE OF r
  `.execute(trx);
  const row = result.rows[0];
  return row === undefined ? null : toView(row);
}

/**
 * Serialises two sends carrying the same key for the rest of the transaction,
 * so a replay that races its original waits and then finds the referral.
 */
export async function lockIdempotencyKey(trx: Tx, key: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`referral-key:${key}`}, 0))`.execute(
    trx,
  );
}

/** The referral a replayed send already made. */
export async function findByIdempotencyKey(trx: Tx, key: string): Promise<ReferralView | null> {
  const result = await sql<ReferralSqlRow>`
    ${REFERRAL_SELECT}
     WHERE r.idempotency_key = ${key}
  `.execute(trx);
  const row = result.rows[0];
  return row === undefined ? null : toView(row);
}

/**
 * The referral of this case another ER is still answering, if any — what
 * holds the case (`referrals_one_open_per_case`).
 */
export async function openReferralOf(trx: Tx, caseId: string): Promise<string | null> {
  const result = await sql<{ id: string }>`
    SELECT id FROM referrals
     WHERE emergency_case_id = ${caseId}::uuid
       AND closed_at IS NULL
       AND deleted_at IS NULL
  `.execute(trx);
  return result.rows[0]?.id ?? null;
}

/** `POST /referrals`. The summary is the case as it stands, and the note. */
export async function insertReferral(
  trx: Tx,
  input: {
    readonly fromHospitalId: string;
    readonly toHospitalId: string;
    readonly emergencyCaseId: string;
    readonly requiredCapability: CapabilityKind | null;
    readonly requiredBedKind: BedKind | null;
    readonly summary: ReferralSummary;
    readonly idempotencyKey: string | null;
    readonly createdBy: string;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO referrals
      (from_hospital_id, to_hospital_id, emergency_case_id, required_capability,
       required_bed_kind, summary, idempotency_key, created_by)
    VALUES (
      ${input.fromHospitalId}::uuid, ${input.toHospitalId}::uuid,
      ${input.emergencyCaseId}::uuid, ${input.requiredCapability}::capability_kind,
      ${input.requiredBedKind}::bed_kind, ${JSON.stringify(input.summary)}::jsonb,
      ${input.idempotencyKey}, ${input.createdBy}::uuid
    )
    RETURNING id
  `.execute(trx);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('referrals insert returned no id.');
  return id;
}

/**
 * What a step changes. Each field is written only when present, and each
 * stamp only once: `seen` keeps the first time anybody looked, whatever
 * answers come after it.
 */
export interface ReferralWrite {
  readonly state: ReferralState;
  readonly seen?: true;
  /** The person who answered; stamps `responded_at`. */
  readonly respondedBy?: string;
  readonly declineReason?: string;
  /** The case the receiving ER opened; stamps `arrived_at`. */
  readonly arrivedCaseId?: string;
  readonly closed?: true;
}

export async function writeReferral(
  trx: Tx,
  referralId: string,
  write: ReferralWrite,
): Promise<void> {
  await sql`
    UPDATE referrals
       SET state           = ${write.state}::referral_state,
           seen_at         = CASE WHEN ${write.seen === true} THEN coalesce(seen_at, now()) ELSE seen_at END,
           responded_at    = CASE WHEN ${write.respondedBy !== undefined} THEN now() ELSE responded_at END,
           responded_by    = coalesce(${write.respondedBy ?? null}::uuid, responded_by),
           decline_reason  = coalesce(${write.declineReason ?? null}, decline_reason),
           arrived_case_id = coalesce(${write.arrivedCaseId ?? null}::uuid, arrived_case_id),
           arrived_at      = CASE WHEN ${write.arrivedCaseId !== undefined} THEN now() ELSE arrived_at END,
           closed_at       = CASE WHEN ${write.closed === true} THEN now() ELSE closed_at END
     WHERE id = ${referralId}::uuid
  `.execute(trx);
}

/**
 * Everything the ER console shows about referrals (`S-B-07`): every open one
 * this hospital sent or was sent, and today's closed ones with their
 * timelines — newest first.
 */
export async function referralsAt(hospitalId: string, today: DhakaDate): Promise<ReferralView[]> {
  const result = await sql<ReferralSqlRow>`
    ${REFERRAL_SELECT}
     WHERE (r.from_hospital_id = ${hospitalId}::uuid OR r.to_hospital_id = ${hospitalId}::uuid)
       AND r.deleted_at IS NULL
       AND (
         r.closed_at IS NULL
         OR (r.closed_at AT TIME ZONE 'Asia/Dhaka')::date = ${today}::date
       )
     ORDER BY r.sent_at DESC, r.id
  `.execute(db);
  return result.rows.map(toView);
}

function iso(value: Date | null): Timestamp | null {
  return value === null ? null : (value.toISOString() as Timestamp);
}
