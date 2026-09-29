/**
 * Staff sign-in (pilot step 21, `S-B-00`, FR-SEC-06, BACKEND.md §7.1).
 *
 * Individual accounts only: a person signs in with their own email and
 * password, and the access token carries every role they hold at their own
 * facility (`FR-ROLE-01`, `FR-ROLE-02`) — the same claims the demo picker's
 * token carries, so every guard written since step 3 applies unchanged.
 *
 * ## What an attacker learns
 *
 * Nothing about which addresses have accounts: an unknown email, a wrong
 * password and a deactivated account all get `AUTH_INVALID_CREDENTIALS`, and
 * an unknown email burns the same scrypt work as a known one. Five failures in
 * a row lock the account for fifteen minutes (`AUTH_LOCKED`), counted per
 * account so guessing from many machines is stopped too.
 *
 * ## Tokens
 *
 * The access token is a 15-minute JWT (`JWT_ACCESS_TTL`). The refresh token is
 * opaque — `<session id>.<32 random bytes>` — and only its SHA-256 is stored
 * (`sessions_auth`). Refreshing revokes the row and writes a new one, so a
 * token works once. A revoked token presented again means two parties hold
 * it, and every session of that account is revoked.
 *
 * A password an administrator set (`must_change_password`, 0027) signs in,
 * but its token carries `mcp` and opens only the password change
 * (`attachPrincipal`).
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { durationMs, signToken } from '../config/jwt.js';
import { logger } from '../config/logger.js';
import {
  burnVerification,
  hashPassword,
  needsRehash,
  passwordProblem,
  temporaryPassword,
  verifyPassword,
} from '../config/password.js';
import { env } from '../env.js';
import { AppError } from '../errors/AppError.js';
import * as chamberRepo from '../repositories/chamber.repo.js';
import * as staffAuthRepo from '../repositories/staffAuth.repo.js';
import { withTransaction } from '../repositories/transaction.js';

import type { StaffAccount } from '../repositories/staffAuth.repo.js';

/** What a successful sign-in, refresh or password change hands the console. */
export interface StaffSession {
  readonly access: string;
  readonly accessExpiresAt: string;
  readonly refresh: string;
  readonly staff: { readonly id: string; readonly fullName: string; readonly email: string };
  readonly hospital: {
    readonly id: string;
    readonly code: string | null;
    readonly nameBn: string;
    readonly nameEn: string;
  } | null;
  readonly roles: readonly string[];
  readonly mustChangePassword: boolean;
}

interface Client {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

const invalidCredentials = (): AppError => new AppError('AUTH_INVALID_CREDENTIALS');

const lockedUntil = (until: Date): AppError =>
  new AppError('AUTH_LOCKED', { details: { until: until.toISOString() } });

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isLocked(account: StaffAccount, now: Date): boolean {
  return account.lockedUntil !== null && account.lockedUntil.getTime() > now.getTime();
}

async function issue(
  account: StaffAccount,
  roles: readonly string[],
  client: Client,
): Promise<StaffSession> {
  const accessTtl = durationMs(env.JWT_ACCESS_TTL);
  const access = await signToken({
    kind: 'access',
    claims: {
      sub: account.id,
      kind: 'staff',
      ...(account.hospitalId === null ? {} : { hospitalId: account.hospitalId }),
      roles,
      ...(account.mustChangePassword ? { mcp: true } : {}),
    },
  });

  const secret = randomBytes(32).toString('base64url');
  const sessionId = await staffAuthRepo.createRefreshSession({
    staffId: account.id,
    tokenHash: sha256(secret),
    expiresAt: new Date(Date.now() + durationMs(env.JWT_REFRESH_TTL)),
    ip: client.ip,
    userAgent: client.userAgent === null ? null : client.userAgent.slice(0, 300),
  });

  return {
    access,
    // A little under the token's own lifetime, so the console refreshes before
    // the server would refuse it rather than after.
    accessExpiresAt: new Date(Date.now() + accessTtl - 5_000).toISOString(),
    refresh: `${sessionId}.${secret}`,
    staff: { id: account.id, fullName: account.fullName, email: account.email },
    hospital:
      account.hospitalId === null
        ? null
        : {
            id: account.hospitalId,
            code: account.hospitalCode,
            nameBn: account.hospitalNameBn ?? '',
            nameEn: account.hospitalNameEn ?? '',
          },
    roles,
    mustChangePassword: account.mustChangePassword,
  };
}

async function rolesOrRefuse(account: StaffAccount): Promise<string[]> {
  const roles = await staffAuthRepo.rolesOf(account.id, account.hospitalId);
  if (roles.length === 0) {
    // An account with no role can open nothing. Saying so is more use to the
    // administrator who forgot to grant one than a generic refusal.
    throw new AppError('AUTH_FORBIDDEN_SCOPE', { details: { reason: 'no_roles' } });
  }
  return roles;
}

async function fail(account: StaffAccount): Promise<AppError> {
  const until = await staffAuthRepo.recordFailure(
    account.id,
    env.STAFF_LOCKOUT_ATTEMPTS,
    env.STAFF_LOCKOUT_MINUTES,
  );
  return until !== null && until.getTime() > Date.now() ? lockedUntil(until) : invalidCredentials();
}

/** `POST /staff/login`. */
export async function login(
  input: {
    readonly email: string;
    readonly password: string;
    readonly hospitalCode?: string | undefined;
  },
  client: Client,
): Promise<StaffSession> {
  const now = new Date();
  const accounts = await staffAuthRepo.findByEmail(input.email, input.hospitalCode ?? null);

  if (accounts.length === 0) {
    await burnVerification(input.password);
    throw invalidCredentials();
  }

  // One email at several facilities on this deployment. The password decides
  // which account is meant; only when it opens more than one is the hospital
  // code asked for — so the question itself reveals nothing to somebody who
  // does not know the password.
  const open = accounts.filter((account) => !isLocked(account, now));
  const matches: StaffAccount[] = [];
  for (const account of open) {
    if (account.isActive && (await verifyPassword(input.password, account.passwordHash))) {
      matches.push(account);
    }
  }

  if (matches.length > 1) throw new AppError('AUTH_HOSPITAL_REQUIRED');

  const account = matches[0];
  if (account === undefined) {
    if (open.length === 0) {
      const soonest = accounts
        .map((candidate) => candidate.lockedUntil)
        .filter((until): until is Date => until !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      throw lockedUntil(soonest ?? now);
    }
    // Every account this email names takes the failure: it is one person's
    // address, and a guess at it is a guess at each.
    const outcomes = await Promise.all(open.map(async (candidate) => await fail(candidate)));
    throw outcomes.find((outcome) => outcome.code === 'AUTH_LOCKED') ?? invalidCredentials();
  }

  const roles = await rolesOrRefuse(account);
  await staffAuthRepo.recordSuccess(account.id);
  if (account.passwordHash !== null && needsRehash(account.passwordHash)) {
    await staffAuthRepo.upgradeHash(account.id, await hashPassword(input.password));
  }

  logger.info({ staffId: account.id, hospitalId: account.hospitalId }, 'staff signed in');
  return await issue(account, roles, client);
}

function parseRefresh(token: string): { readonly id: string; readonly secret: string } | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!/^[0-9a-f-]{36}$/i.test(id) || secret.length < 20) return null;
  return { id, secret };
}

function hashMatches(secret: string, stored: string): boolean {
  const candidate = Buffer.from(sha256(secret), 'hex');
  const expected = Buffer.from(stored, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const refreshInvalid = (reason: string): AppError =>
  new AppError('AUTH_TOKEN_INVALID', { details: { reason } });

/** `POST /staff/refresh`. Rotates: this token stops working. */
export async function refresh(token: string, client: Client): Promise<StaffSession> {
  const parsed = parseRefresh(token);
  if (parsed === null) throw refreshInvalid('malformed');

  const session = await staffAuthRepo.findRefreshSession(parsed.id);
  if (session === null || !hashMatches(parsed.secret, session.tokenHash)) {
    throw refreshInvalid('unknown');
  }

  if (session.revokedAt !== null) {
    // A token that was already used is being used again: two parties hold it.
    // Revoke everything the account has open and make it sign in again.
    await staffAuthRepo.revokeOtherSessions(session.subjectId, null);
    logger.warn({ staffId: session.subjectId }, 'refresh token reused; sessions revoked');
    throw refreshInvalid('reused');
  }
  if (session.expiresAt.getTime() <= Date.now()) throw refreshInvalid('expired');

  const account = await staffAuthRepo.findById(session.subjectId);
  if (account?.isActive !== true) throw refreshInvalid('account');

  // Two refreshes racing with the same token: only the one that revokes the
  // row goes on, and the other is refused rather than issued a second session.
  if (!(await staffAuthRepo.revokeRefreshSession(session.id))) throw refreshInvalid('raced');

  return await issue(account, await rolesOrRefuse(account), client);
}

/** `POST /staff/logout`. Quietly does nothing for a token it does not recognise. */
export async function logout(token: string): Promise<void> {
  const parsed = parseRefresh(token);
  if (parsed === null) return;
  const session = await staffAuthRepo.findRefreshSession(parsed.id);
  if (session !== null && hashMatches(parsed.secret, session.tokenHash)) {
    await staffAuthRepo.revokeRefreshSession(session.id);
  }
}

async function accountOf(staffId: string): Promise<StaffAccount> {
  const account = await staffAuthRepo.findById(staffId);
  if (account?.isActive !== true) throw new AppError('AUTH_REQUIRED');
  return account;
}

/** Who is signed in, without any token — `GET /staff/me`. */
export type StaffProfile = Omit<StaffSession, 'access' | 'accessExpiresAt' | 'refresh'>;

/** `GET /staff/me`. */
export async function me(staffId: string): Promise<StaffProfile> {
  const account = await accountOf(staffId);
  return {
    staff: { id: account.id, fullName: account.fullName, email: account.email },
    hospital:
      account.hospitalId === null
        ? null
        : {
            id: account.hospitalId,
            code: account.hospitalCode,
            nameBn: account.hospitalNameBn ?? '',
            nameEn: account.hospitalNameEn ?? '',
          },
    roles: await staffAuthRepo.rolesOf(account.id, account.hospitalId),
    mustChangePassword: account.mustChangePassword,
  };
}

/**
 * `POST /staff/password`. The current password is asked for even right after
 * signing in, so a console left open cannot have its password changed by
 * whoever walks up to it. A success revokes every other session and hands
 * back a fresh one without `mcp`.
 */
export async function changePassword(
  staffId: string,
  input: { readonly current: string; readonly next: string },
  client: Client,
): Promise<StaffSession> {
  const account = await accountOf(staffId);
  if (isLocked(account, new Date()) && account.lockedUntil !== null) {
    throw lockedUntil(account.lockedUntil);
  }
  if (!(await verifyPassword(input.current, account.passwordHash))) throw await fail(account);

  const problem = passwordProblem(input.next, input.current);
  if (problem !== null) throw new AppError('AUTH_PASSWORD_WEAK', { details: { reason: problem } });

  await staffAuthRepo.setPassword(account.id, await hashPassword(input.next), false);
  await staffAuthRepo.revokeOtherSessions(account.id, null);

  const updated = await accountOf(account.id);
  return await issue(updated, await rolesOrRefuse(updated), client);
}

/** `GET /staff/chambers` — today's chambers at the caller's own facility. */
export async function chambers(hospitalId: string): Promise<chamberRepo.ChamberRow[]> {
  return await chamberRepo.todaysChambers(hospitalId);
}

// --- The first administrator (the `staff:create` command) ---------------------

export interface FirstAdministrator {
  readonly hospitalId: string;
  readonly staffId: string;
  readonly temporaryPassword: string;
  readonly createdHospital: boolean;
}

/**
 * Creates a facility's first administrator — and the facility itself when the
 * code is new. Nobody can create accounts from a screen until one
 * administrator exists (`S-B-11`, step 22), so this is how a fresh
 * deployment starts. The password it prints must be changed at first sign-in.
 */
export async function createFirstAdministrator(input: {
  readonly hospitalCode: string;
  readonly hospital?: {
    readonly nameBn: string;
    readonly nameEn: string;
    readonly kind: string;
    readonly division: string;
    readonly district: string;
  };
  readonly email: string;
  readonly fullName: string;
}): Promise<FirstAdministrator> {
  const code = input.hospitalCode.toUpperCase();
  const existing = await staffAuthRepo.hospitalIdByCode(code);
  if (existing === null && input.hospital === undefined) {
    throw new Error(
      `No facility has the code ${code}; give its names, kind, division and district to create it.`,
    );
  }
  if (existing !== null && (await staffAuthRepo.emailTakenAt(existing, input.email))) {
    throw new Error(`${input.email} already has an account at ${code}.`);
  }

  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);

  const newHospital = input.hospital;
  return await withTransaction(async (trx) => {
    let hospitalId = existing;
    if (hospitalId === null) {
      if (newHospital === undefined) throw new Error('unreachable: checked above');
      hospitalId = await staffAuthRepo.createHospital(trx, { code, ...newHospital });
    }
    const staffId = await staffAuthRepo.createStaffAccount(trx, {
      hospitalId,
      email: input.email,
      fullName: input.fullName,
      staffCode: null,
      passwordHash,
      createdBy: null,
    });
    await staffAuthRepo.grantRole(trx, { staffId, hospitalId, role: 'hospital_admin' });
    return { hospitalId, staffId, temporaryPassword: password, createdHospital: existing === null };
  });
}
