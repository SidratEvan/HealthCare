/**
 * A patient's phone sign-in and the records they claim with it (pilot step 25,
 * `FR-PAT-01`, `FR-PAT-04`, `FR-GST-09`, `FR-IMP-10`, `FR-SEC-05`).
 *
 * Rows only: codes sent (`otp_challenges`), account holders (`users`), their
 * refresh sessions (`sessions_auth`, `subject_kind = 'user'`), and the
 * patients a verified number may take over.
 */

import { sql } from 'kysely';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

// --- codes (otp_challenges) --------------------------------------------------

/** Codes sent to this number in the last hour, for `OTP_MAX_PER_HOUR`. */
export async function sentInLastHour(phone: string): Promise<number> {
  const result = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM otp_challenges
     WHERE phone = ${phone} AND created_at > now() - interval '1 hour'
  `.execute(db);
  return result.rows[0]?.n ?? 0;
}

/** When the number's lock ends, if it is locked now. */
export async function lockedUntil(phone: string): Promise<Date | null> {
  const result = await sql<{ locked_until: Date }>`
    SELECT max(locked_until) AS locked_until FROM otp_challenges
     WHERE phone = ${phone} AND locked_until > now()
  `.execute(db);
  return result.rows[0]?.locked_until ?? null;
}

export async function createChallenge(input: {
  readonly phone: string;
  readonly codeHash: string;
  readonly expiresAt: Date;
  readonly ip: string | null;
}): Promise<string> {
  // A new code replaces any still open for the number: only the latest works.
  await sql`
    UPDATE otp_challenges SET consumed_at = now()
     WHERE phone = ${input.phone} AND consumed_at IS NULL
  `.execute(db);
  const result = await sql<{ id: string }>`
    INSERT INTO otp_challenges (phone, code_hash, expires_at, ip)
    VALUES (${input.phone}, ${input.codeHash}, ${input.expiresAt}, ${input.ip}::inet)
    RETURNING id
  `.execute(db);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('otp_challenges returned no id');
  return id;
}

export interface OpenChallenge {
  readonly id: string;
  readonly codeHash: string;
  readonly attempts: number;
  readonly expiresAt: Date;
}

/** The number's latest code, if it has not been used or replaced. */
export async function openChallenge(phone: string): Promise<OpenChallenge | null> {
  const result = await sql<{ id: string; code_hash: string; attempts: number; expires_at: Date }>`
    SELECT id, code_hash, attempts, expires_at FROM otp_challenges
     WHERE phone = ${phone} AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1
  `.execute(db);
  const row = result.rows[0];
  return row === undefined
    ? null
    : { id: row.id, codeHash: row.code_hash, attempts: row.attempts, expiresAt: row.expires_at };
}

/**
 * Counts a wrong code. At `maxAttempts` the code is spent and the number
 * locked for `lockMinutes`. Returns the attempts so far and any lock.
 */
export async function recordWrongCode(
  challengeId: string,
  maxAttempts: number,
  lockMinutes: number,
): Promise<{ attempts: number; lockedUntil: Date | null }> {
  const result = await sql<{ attempts: number; locked_until: Date | null }>`
    UPDATE otp_challenges SET
      attempts = attempts + 1,
      locked_until = CASE WHEN attempts + 1 >= ${maxAttempts}
                          THEN now() + make_interval(mins => ${lockMinutes}) ELSE locked_until END,
      consumed_at = CASE WHEN attempts + 1 >= ${maxAttempts} THEN now() ELSE consumed_at END
     WHERE id = ${challengeId}
    RETURNING attempts, locked_until
  `.execute(db);
  const row = result.rows[0];
  return { attempts: row?.attempts ?? maxAttempts, lockedUntil: row?.locked_until ?? null };
}

/** Uses the code, once. Returns false when another request used it first. */
export async function consume(challengeId: string): Promise<boolean> {
  const result = await sql`
    UPDATE otp_challenges SET consumed_at = now() WHERE id = ${challengeId} AND consumed_at IS NULL
  `.execute(db);
  return Number(result.numAffectedRows ?? 0) === 1;
}

// --- account holders (users) ---------------------------------------------------

/** The account for a verified number, made on first sign-in (`FR-PAT-01`). */
export async function signInUser(phone: string): Promise<{ id: string; isNew: boolean }> {
  const existing = await sql<{ id: string }>`
    UPDATE users SET phone_verified_at = now(), last_login_at = now()
     WHERE phone = ${phone} AND deleted_at IS NULL
    RETURNING id
  `.execute(db);
  const found = existing.rows[0]?.id;
  if (found !== undefined) return { id: found, isNew: false };
  const created = await sql<{ id: string }>`
    INSERT INTO users (phone, kind, phone_verified_at, last_login_at)
    VALUES (${phone}, 'patient', now(), now())
    ON CONFLICT (phone) WHERE deleted_at IS NULL DO UPDATE SET last_login_at = now()
    RETURNING id, (xmax = 0) AS inserted
  `.execute(db);
  const id = created.rows[0]?.id;
  if (id === undefined) throw new Error('users returned no id');
  return { id, isNew: true };
}

export async function userById(userId: string): Promise<{ id: string; phone: string } | null> {
  const result = await sql<{ id: string; phone: string }>`
    SELECT id, phone FROM users WHERE id = ${userId} AND deleted_at IS NULL
  `.execute(db);
  return result.rows[0] ?? null;
}

// --- refresh sessions (sessions_auth, subject_kind 'user') --------------------

export async function createSession(input: {
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly ip: string | null;
  readonly device: string | null;
}): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO sessions_auth (subject_id, subject_kind, token_hash, device_fingerprint, ip, expires_at)
    VALUES (${input.userId}, 'user', ${input.tokenHash}, ${input.device}, ${input.ip}::inet, ${input.expiresAt})
    RETURNING id
  `.execute(db);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('sessions_auth returned no id');
  return id;
}

export async function findSession(id: string): Promise<{
  id: string;
  userId: string;
  tokenHash: string;
  device: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
} | null> {
  const result = await sql<{
    id: string;
    subject_id: string;
    token_hash: string;
    device_fingerprint: string | null;
    expires_at: Date;
    revoked_at: Date | null;
  }>`
    SELECT id, subject_id, token_hash, device_fingerprint, expires_at, revoked_at
      FROM sessions_auth WHERE id = ${id} AND subject_kind = 'user'
  `.execute(db);
  const row = result.rows[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        userId: row.subject_id,
        tokenHash: row.token_hash,
        device: row.device_fingerprint,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
      };
}

export async function revokeSession(id: string): Promise<boolean> {
  const result = await sql`
    UPDATE sessions_auth SET revoked_at = now(), updated_at = now() WHERE id = ${id} AND revoked_at IS NULL
  `.execute(db);
  return Number(result.numAffectedRows ?? 0) === 1;
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await sql`
    UPDATE sessions_auth SET revoked_at = now(), updated_at = now()
     WHERE subject_kind = 'user' AND subject_id = ${userId} AND revoked_at IS NULL
  `.execute(db);
}

// --- profiles and claiming (FR-PAT-02, FR-PAT-04, FR-GST-09, FR-IMP-10) --------

export interface ProfileRow {
  readonly patientId: string;
  readonly fullName: string;
  readonly ageYears: number | null;
  readonly sex: string;
  readonly relationship: string;
  readonly isPrimary: boolean;
  readonly bookings: number;
  readonly visits: number;
}

const PROFILE_COLUMNS = sql`
  p.id AS patient_id, p.full_name,
  coalesce(p.age_years, date_part('year', age(p.date_of_birth))::int) AS age_years,
  p.sex::text AS sex, p.relationship, p.is_primary,
  (SELECT count(*)::int FROM bookings b WHERE b.patient_id = p.id AND b.deleted_at IS NULL) AS bookings,
  (SELECT count(*)::int FROM visits v WHERE v.patient_id = p.id) AS visits
`;

interface RawProfile {
  patient_id: string;
  full_name: string;
  age_years: number | null;
  sex: string;
  relationship: string;
  is_primary: boolean;
  bookings: number;
  visits: number;
}

function toProfile(row: RawProfile): ProfileRow {
  return {
    patientId: row.patient_id,
    fullName: row.full_name,
    ageYears: row.age_years,
    sex: row.sex,
    relationship: row.relationship,
    isPrimary: row.is_primary,
    bookings: row.bookings,
    visits: row.visits,
  };
}

/** The account's own profiles. */
export async function profilesOf(userId: string): Promise<ProfileRow[]> {
  const result = await sql<RawProfile>`
    SELECT ${PROFILE_COLUMNS} FROM patients p
     WHERE p.owner_user_id = ${userId} AND p.deleted_at IS NULL
     ORDER BY p.is_primary DESC, p.full_name
  `.execute(db);
  return result.rows.map(toProfile);
}

/**
 * What a verified number may take over: patients held for it as a guest, and
 * patients a hospital imported with it — each hospital's shown by name, since
 * the person may not know that hospital held them.
 */
export async function claimableFor(
  phone: string,
): Promise<(ProfileRow & { hospitalNameBn: string | null; hospitalNameEn: string | null })[]> {
  const result = await sql<
    RawProfile & { hospital_name_bn: string | null; hospital_name_en: string | null }
  >`
    SELECT ${PROFILE_COLUMNS}, h.name_bn AS hospital_name_bn, h.name_en AS hospital_name_en
      FROM patients p
      LEFT JOIN guest_identities g ON g.id = p.owner_guest_id
      LEFT JOIN hospitals h ON h.id = p.owner_hospital_id
     WHERE p.deleted_at IS NULL
       AND ((g.phone = ${phone} AND g.claimed_by_user_id IS NULL AND g.deleted_at IS NULL)
            OR (p.owner_hospital_id IS NOT NULL AND p.phone = ${phone}))
     ORDER BY p.full_name
  `.execute(db);
  return result.rows.map((row) => ({
    ...toProfile(row),
    hospitalNameBn: row.hospital_name_bn,
    hospitalNameEn: row.hospital_name_en,
  }));
}

/**
 * Moves everything the number holds to the account, in one statement per
 * owner kind. The account keeps at most one "self" profile: a claimed one is
 * primary only if the account had none.
 */
export async function claim(
  trx: Tx,
  input: { readonly userId: string; readonly phone: string },
): Promise<number> {
  const primary = await sql<{ has: boolean }>`
    SELECT EXISTS (SELECT 1 FROM patients WHERE owner_user_id = ${input.userId} AND is_primary AND deleted_at IS NULL) AS has
  `.execute(trx);
  const hasPrimary = primary.rows[0]?.has ?? false;

  const guests = await sql<{ id: string }>`
    UPDATE guest_identities SET claimed_by_user_id = ${input.userId}, claimed_at = now()
     WHERE phone = ${input.phone} AND claimed_by_user_id IS NULL AND deleted_at IS NULL
    RETURNING id
  `.execute(trx);
  const guestIds = guests.rows.map((row) => row.id);

  const fromGuest = await sql`
    UPDATE patients SET owner_user_id = ${input.userId}, owner_guest_id = NULL,
           is_primary = is_primary AND NOT ${hasPrimary}, updated_at = now()
     WHERE owner_guest_id = ANY(${guestIds}::uuid[]) AND deleted_at IS NULL
  `.execute(trx);
  const fromHospital = await sql`
    UPDATE patients SET owner_user_id = ${input.userId}, owner_hospital_id = NULL, is_primary = false,
           updated_at = now()
     WHERE owner_hospital_id IS NOT NULL AND phone = ${input.phone} AND deleted_at IS NULL
  `.execute(trx);
  return Number(fromGuest.numAffectedRows ?? 0) + Number(fromHospital.numAffectedRows ?? 0);
}

/** One audit row for a claim, on the account (`DB-P7`). */
export async function auditClaim(
  trx: Tx,
  input: { readonly userId: string; readonly moved: number },
): Promise<void> {
  await sql`
    INSERT INTO audit_log (actor_user_id, action, subject_table, subject_id, meta)
    VALUES (${input.userId}, 'SETTINGS_CHANGE', 'users', ${input.userId},
            ${JSON.stringify({ change: 'claimed_records', moved: input.moved })}::jsonb)
  `.execute(trx);
}
