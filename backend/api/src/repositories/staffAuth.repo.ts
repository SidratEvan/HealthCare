/**
 * Staff accounts and their login sessions (pilot step 21, FR-SEC-06).
 *
 * Reads and writes rows, nothing more: the decisions — whether a password
 * matches, when an account locks, what a token carries — are the service's.
 * An email is matched case-insensitively (`staff_users_email_idx`, 0027); a
 * hospital code only narrows a login when the same email exists at more than
 * one facility on the deployment.
 */

import { sql } from 'kysely';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

type Executor = typeof db | Tx;

/** Everything the login needs about one account. */
export interface StaffAccount {
  readonly id: string;
  readonly hospitalId: string | null;
  readonly email: string;
  readonly fullName: string;
  readonly passwordHash: string | null;
  readonly isActive: boolean;
  readonly mustChangePassword: boolean;
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | null;
  readonly hospitalCode: string | null;
  readonly hospitalNameBn: string | null;
  readonly hospitalNameEn: string | null;
}

interface AccountRow {
  id: string;
  hospital_id: string | null;
  email: string;
  full_name: string;
  password_hash: string | null;
  is_active: boolean;
  must_change_password: boolean;
  failed_login_count: number;
  locked_until: Date | null;
  hospital_code: string | null;
  hospital_name_bn: string | null;
  hospital_name_en: string | null;
}

function toAccount(row: AccountRow): StaffAccount {
  return {
    id: row.id,
    hospitalId: row.hospital_id,
    email: row.email,
    fullName: row.full_name,
    passwordHash: row.password_hash,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until,
    hospitalCode: row.hospital_code,
    hospitalNameBn: row.hospital_name_bn,
    hospitalNameEn: row.hospital_name_en,
  };
}

const ACCOUNT_COLUMNS = sql`
  su.id, su.hospital_id, su.email, su.full_name, su.password_hash, su.is_active,
  su.must_change_password, su.failed_login_count, su.locked_until,
  h.code AS hospital_code, h.name_bn AS hospital_name_bn, h.name_en AS hospital_name_en
`;

/**
 * Every live account with this email — one per facility at most, by
 * `staff_users`' `(email, hospital_id)` key. With a hospital code, only the
 * account at that facility.
 */
export async function findByEmail(
  email: string,
  hospitalCode: string | null,
): Promise<StaffAccount[]> {
  const result = await sql<AccountRow>`
    SELECT ${ACCOUNT_COLUMNS}
      FROM staff_users su
      LEFT JOIN hospitals h ON h.id = su.hospital_id AND h.deleted_at IS NULL
     WHERE lower(su.email) = lower(${email})
       AND su.deleted_at IS NULL
       AND (${hospitalCode}::text IS NULL OR h.code = upper(${hospitalCode}::text))
     ORDER BY su.created_at
  `.execute(db);
  return result.rows.map(toAccount);
}

export async function findById(staffId: string): Promise<StaffAccount | null> {
  const result = await sql<AccountRow>`
    SELECT ${ACCOUNT_COLUMNS}
      FROM staff_users su
      LEFT JOIN hospitals h ON h.id = su.hospital_id AND h.deleted_at IS NULL
     WHERE su.id = ${staffId} AND su.deleted_at IS NULL
  `.execute(db);
  const row = result.rows[0];
  return row === undefined ? null : toAccount(row);
}

/**
 * The roles an account holds at its own facility — or, for a national
 * account, its national roles (`FR-ROLE-01`, 0024).
 */
export async function rolesOf(staffId: string, hospitalId: string | null): Promise<string[]> {
  const result = await sql<{ role: string }>`
    SELECT DISTINCT role::text AS role
      FROM staff_roles
     WHERE staff_user_id = ${staffId}
       AND hospital_id IS NOT DISTINCT FROM ${hospitalId}::uuid
       -- A role an administrator removed (pilot step 22) is kept for the record
       -- and opens nothing.
       AND deleted_at IS NULL
     ORDER BY role
  `.execute(db);
  return result.rows.map((row) => row.role);
}

/**
 * Counts one failure. When it reaches `attempts`, locks the account for
 * `lockMinutes` and starts the count again, so the next lock needs the same
 * number of fresh failures. Returns when the account opens, or null.
 */
export async function recordFailure(
  staffId: string,
  attempts: number,
  lockMinutes: number,
): Promise<Date | null> {
  const result = await sql<{ locked_until: Date | null }>`
    UPDATE staff_users
       SET failed_login_count = CASE WHEN failed_login_count + 1 >= ${attempts}
                                     THEN 0 ELSE failed_login_count + 1 END,
           locked_until       = CASE WHEN failed_login_count + 1 >= ${attempts}
                                     THEN now() + make_interval(mins => ${lockMinutes})
                                     ELSE locked_until END,
           updated_at         = now()
     WHERE id = ${staffId}
     RETURNING locked_until
  `.execute(db);
  return result.rows[0]?.locked_until ?? null;
}

/** A successful sign-in: the failure count and any lock are cleared. */
export async function recordSuccess(staffId: string): Promise<void> {
  await sql`
    UPDATE staff_users
       SET failed_login_count = 0, locked_until = NULL, last_login_at = now(), updated_at = now()
     WHERE id = ${staffId}
  `.execute(db);
}

/** Stores a new hash. `mustChange` is true when an administrator set it. */
export async function setPassword(
  staffId: string,
  passwordHash: string,
  mustChange: boolean,
  executor: Executor = db,
): Promise<void> {
  await sql`
    UPDATE staff_users
       SET password_hash = ${passwordHash}, must_change_password = ${mustChange},
           password_changed_at = now(), failed_login_count = 0, locked_until = NULL,
           updated_at = now()
     WHERE id = ${staffId}
  `.execute(executor);
}

/** Rewrites a hash made with weaker parameters, after a login proved the password. */
export async function upgradeHash(staffId: string, passwordHash: string): Promise<void> {
  await sql`UPDATE staff_users SET password_hash = ${passwordHash}, updated_at = now() WHERE id = ${staffId}`.execute(
    db,
  );
}

// --- Refresh sessions (sessions_auth) -----------------------------------------

export interface RefreshSession {
  readonly id: string;
  readonly subjectId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export async function createRefreshSession(input: {
  readonly staffId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly ip: string | null;
  readonly userAgent: string | null;
}): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO sessions_auth (subject_id, subject_kind, token_hash, device_fingerprint, ip, expires_at)
    VALUES (${input.staffId}, 'staff', ${input.tokenHash}, ${input.userAgent},
            ${input.ip}::inet, ${input.expiresAt})
    RETURNING id
  `.execute(db);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('sessions_auth returned no id');
  return id;
}

export async function findRefreshSession(id: string): Promise<RefreshSession | null> {
  const result = await sql<{
    id: string;
    subject_id: string;
    token_hash: string;
    expires_at: Date;
    revoked_at: Date | null;
  }>`
    SELECT id, subject_id, token_hash, expires_at, revoked_at
      FROM sessions_auth
     WHERE id = ${id} AND subject_kind = 'staff'
  `.execute(db);
  const row = result.rows[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        subjectId: row.subject_id,
        tokenHash: row.token_hash,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
      };
}

/**
 * Revokes one refresh session, only if it is still open. Returns whether this
 * call revoked it — so two refreshes racing with the same token cannot both
 * succeed.
 */
export async function revokeRefreshSession(id: string): Promise<boolean> {
  const result = await sql`
    UPDATE sessions_auth SET revoked_at = now(), updated_at = now()
     WHERE id = ${id} AND revoked_at IS NULL
  `.execute(db);
  return Number(result.numAffectedRows ?? 0) === 1;
}

/** Revokes every open session of an account except `keep`. */
export async function revokeOtherSessions(staffId: string, keep: string | null): Promise<void> {
  await sql`
    UPDATE sessions_auth SET revoked_at = now(), updated_at = now()
     WHERE subject_kind = 'staff' AND subject_id = ${staffId} AND revoked_at IS NULL
       AND (${keep}::uuid IS NULL OR id <> ${keep}::uuid)
  `.execute(db);
}

// --- Creating a facility's first administrator (the `staff:create` command) ---

export async function hospitalIdByCode(code: string): Promise<string | null> {
  const result = await sql<{ id: string }>`
    SELECT id FROM hospitals WHERE code = ${code} AND deleted_at IS NULL
  `.execute(db);
  return result.rows[0]?.id ?? null;
}

/**
 * A facility with nothing in it yet, and its settings row at the defaults
 * (0004). It is not live: `is_live` goes true when the hospital is set up
 * (`S-B-11`, pilot step 22), so nothing public lists an empty facility.
 */
export async function createHospital(
  trx: Tx,
  input: {
    readonly code: string;
    readonly nameBn: string;
    readonly nameEn: string;
    readonly kind: string;
    readonly division: string;
    readonly district: string;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO hospitals (code, name_bn, name_en, kind, division, district, is_live)
    VALUES (${input.code}, ${input.nameBn}, ${input.nameEn}, ${input.kind}::facility_kind,
            ${input.division}, ${input.district}, false)
    RETURNING id
  `.execute(trx);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('hospitals returned no id');
  await sql`INSERT INTO hospital_settings (hospital_id) VALUES (${id})`.execute(trx);
  return id;
}

export async function emailTakenAt(hospitalId: string, email: string): Promise<boolean> {
  const result = await sql<{ one: number }>`
    SELECT 1 AS one FROM staff_users
     WHERE hospital_id = ${hospitalId} AND lower(email) = lower(${email}) AND deleted_at IS NULL
  `.execute(db);
  return result.rows.length > 0;
}

/** A new account whose password an administrator set: it must be changed on first use. */
export async function createStaffAccount(
  trx: Tx,
  input: {
    readonly hospitalId: string;
    readonly email: string;
    readonly fullName: string;
    readonly staffCode: string | null;
    readonly passwordHash: string;
    readonly createdBy: string | null;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO staff_users (hospital_id, email, staff_code, full_name, password_hash,
                             must_change_password, password_changed_at, created_by)
    VALUES (${input.hospitalId}, ${input.email.trim()}, ${input.staffCode}, ${input.fullName},
            ${input.passwordHash}, true, now(), ${input.createdBy})
    RETURNING id
  `.execute(trx);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('staff_users returned no id');
  return id;
}

export async function grantRole(
  trx: Tx,
  input: { readonly staffId: string; readonly hospitalId: string; readonly role: string },
): Promise<void> {
  await sql`
    INSERT INTO staff_roles (staff_user_id, hospital_id, role)
    VALUES (${input.staffId}, ${input.hospitalId}, ${input.role}::staff_role)
    ON CONFLICT DO NOTHING
  `.execute(trx);
}
