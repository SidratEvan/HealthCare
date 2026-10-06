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
 *
 * ## The second factor (pilot step 28, FR-SEC-10)
 *
 * An account with one on gets no tokens for a right password: it gets a
 * five-minute challenge, and `POST /staff/2fa` exchanges that and a code from
 * the app (or a recovery code) for the session. A wrong code counts towards
 * the same lock as a wrong password, and the count is not cleared by the
 * password alone — otherwise a known password would buy unlimited guesses at
 * the code, five at a time.
 *
 * An administrator (`TWO_FACTOR_REQUIRED_ROLES`) with none yet signs in on the
 * password once more, but the token carries `tfa: 'setup'` and opens only the
 * setup (`attachPrincipal`), so no administrator reaches a console without it.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { TWO_FACTOR_REQUIRED_ROLES } from '@platform/domain';

import { durationMs, signToken, verifyToken } from '../config/jwt.js';
import { logger } from '../config/logger.js';
import {
  burnVerification,
  hashPassword,
  needsRehash,
  passwordProblem,
  temporaryPassword,
  verifyPassword,
} from '../config/password.js';
import {
  RECOVERY_CODE_COUNT,
  matchStep,
  newRecoveryCodes,
  newTotpSecret,
  normaliseRecoveryCode,
  openSecret,
  otpauthUri,
  recoveryHash,
  sealSecret,
} from '../config/totp.js';
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
  /**
   * The second factor: whether it is on, whether this account must have it,
   * and how many recovery codes are left. `required && !enabled` means the
   * token opens only the setup (`tfa: 'setup'`).
   */
  readonly twoFactor: {
    readonly enabled: boolean;
    readonly required: boolean;
    readonly recoveryCodesLeft: number;
  };
}

/** What `POST /staff/login` answers: a session, or a challenge for the second factor. */
export type StaffLoginResult =
  | (StaffSession & { readonly requires2fa: false })
  | { readonly requires2fa: true; readonly challenge: string; readonly challengeExpiresAt: string };

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

const REQUIRED: readonly string[] = TWO_FACTOR_REQUIRED_ROLES;

/** Whether these roles may sign in only with a second factor (`FR-SEC-10`). */
export function requiresTwoFactor(roles: readonly string[]): boolean {
  return roles.some((role) => REQUIRED.includes(role));
}

function twoFactorOf(account: StaffAccount, roles: readonly string[]): StaffSession['twoFactor'] {
  return {
    enabled: account.totpEnabled,
    required: requiresTwoFactor(roles),
    recoveryCodesLeft: account.totpEnabled ? account.recoveryCodesLeft : 0,
  };
}

async function issue(
  account: StaffAccount,
  roles: readonly string[],
  client: Client,
): Promise<StaffSession> {
  const accessTtl = durationMs(env.JWT_ACCESS_TTL);
  const twoFactor = twoFactorOf(account, roles);
  // The password change comes first; its fresh token then carries `tfa`.
  const setupOnly = twoFactor.required && !twoFactor.enabled && !account.mustChangePassword;
  const access = await signToken({
    kind: 'access',
    claims: {
      sub: account.id,
      kind: 'staff',
      ...(account.hospitalId === null ? {} : { hospitalId: account.hospitalId }),
      roles,
      ...(account.mustChangePassword ? { mcp: true } : {}),
      ...(setupOnly ? { tfa: 'setup' as const } : {}),
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
    twoFactor,
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
): Promise<StaffLoginResult> {
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
  if (account.passwordHash !== null && needsRehash(account.passwordHash)) {
    await staffAuthRepo.upgradeHash(account.id, await hashPassword(input.password));
  }

  if (account.totpEnabled) {
    // Half a sign-in. The failure count stays as it is until the code is right.
    const challenge = await signToken({
      kind: 'staff_2fa',
      claims: { sub: account.id, kind: 'staff' },
    });
    return {
      requires2fa: true,
      challenge,
      challengeExpiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    };
  }

  await staffAuthRepo.recordSuccess(account.id);
  logger.info({ staffId: account.id, hospitalId: account.hospitalId }, 'staff signed in');
  return { ...(await issue(account, roles, client)), requires2fa: false };
}

/** `staff_2fa` tokens' lifetime (`config/jwt.ts`). */
const CHALLENGE_TTL_MS = 5 * 60_000;

const codeInvalid = (): AppError => new AppError('AUTH_2FA_INVALID');

/** A wrong code: counted with wrong passwords, towards the same lock. */
async function failCode(account: StaffAccount): Promise<AppError> {
  const refused = await fail(account);
  return refused.code === 'AUTH_LOCKED' ? refused : codeInvalid();
}

/**
 * Checks a code from the app or a recovery code, and spends it. The shape
 * says which: six digits, or twelve letters and digits.
 */
async function spendCode(account: StaffAccount, code: string): Promise<boolean> {
  if (!account.totpEnabled || account.totpSecret === null) return false;
  if (/^\d{6}$/.test(code)) {
    let secret: string;
    try {
      secret = openSecret(account.totpSecret);
    } catch {
      // Sealed with another key: no code can match it. Said in the log,
      // because the fix is on the server (TOTP_ENCRYPTION_KEY), not the phone.
      logger.error({ staffId: account.id }, 'TOTP secret does not open with this key');
      return false;
    }
    const step = matchStep(secret, code, Date.now(), account.totpLastStep);
    return step !== null && (await staffAuthRepo.acceptTotpStep(account.id, step));
  }
  const recovery = normaliseRecoveryCode(code);
  if (recovery === null) return false;
  const used = await staffAuthRepo.useRecoveryCode(account.id, recoveryHash(recovery));
  if (used) logger.warn({ staffId: account.id }, 'staff signed in with a recovery code');
  return used;
}

/** `POST /staff/2fa`: the challenge from `login` and a code → the session. */
export async function verifySecondFactor(
  input: { readonly challenge: string; readonly code: string },
  client: Client,
): Promise<StaffSession> {
  const verified = await verifyToken(input.challenge, 'staff_2fa');
  if (!verified.ok) throw refreshInvalid(`challenge_${verified.reason}`);

  const account = await staffAuthRepo.findById(verified.claims.sub);
  if (account?.isActive !== true) throw refreshInvalid('account');
  if (isLocked(account, new Date()) && account.lockedUntil !== null) {
    throw lockedUntil(account.lockedUntil);
  }
  // Reset by an administrator since the password was typed: sign in again.
  if (!account.totpEnabled) throw refreshInvalid('challenge_stale');

  if (!(await spendCode(account, input.code.trim()))) throw await failCode(account);

  const roles = await rolesOrRefuse(account);
  await staffAuthRepo.recordSuccess(account.id);
  logger.info({ staffId: account.id, hospitalId: account.hospitalId }, 'staff signed in');
  const updated = await accountOf(account.id);
  return await issue(updated, roles, client);
}

/** What `POST /staff/2fa/setup` hands the person, once, to put into their app. */
export interface TwoFactorSetup {
  readonly secret: string;
  readonly otpauthUri: string;
}

/**
 * `POST /staff/2fa/setup`. The same unconfirmed secret until it is turned on —
 * so a reload, a second tab or a screen that asked twice all show one QR code,
 * and the code typed is checked against the secret that was shown. Never one
 * that is on.
 */
export async function startTwoFactorSetup(staffId: string): Promise<TwoFactorSetup> {
  const account = await accountOf(staffId);
  if (account.totpEnabled) throw new AppError('AUTH_2FA_ALREADY_ON');

  let sealed = await staffAuthRepo.pendingTotp(account.id, sealSecret(newTotpSecret()));
  if (sealed === null) throw new AppError('AUTH_2FA_ALREADY_ON');
  let secret: string;
  try {
    secret = openSecret(sealed);
  } catch {
    // Sealed under another key (TOTP_ENCRYPTION_KEY changed): nobody can use
    // it, so it is replaced rather than offered.
    sealed = await staffAuthRepo.pendingTotp(account.id, sealSecret(newTotpSecret()), true);
    if (sealed === null) throw new AppError('AUTH_2FA_ALREADY_ON');
    secret = openSecret(sealed);
  }
  return {
    secret,
    otpauthUri: otpauthUri({
      secret,
      account: account.email,
      // What the app lists the entry under: the facility, so somebody with
      // accounts at two can tell them apart.
      issuer: account.hospitalNameEn ?? 'MedLiveBD',
    }),
  };
}

/**
 * `POST /staff/2fa/enable`. A code from the app proves it holds the secret;
 * the second factor is then on, the ten recovery codes are shown once, every
 * other session of the account — each issued without it — is ended, and this
 * one is replaced by a session without `tfa`.
 */
export async function enableTwoFactor(
  staffId: string,
  code: string,
  client: Client,
): Promise<{ readonly recoveryCodes: readonly string[]; readonly session: StaffSession }> {
  const account = await accountOf(staffId);
  if (account.totpEnabled) throw new AppError('AUTH_2FA_ALREADY_ON');
  if (account.totpSecret === null) throw codeInvalid();

  let secret: string;
  try {
    secret = openSecret(account.totpSecret);
  } catch {
    throw codeInvalid();
  }
  // Not counted towards the lock: the person is signed in, and the secret
  // being checked is the one they were just shown.
  const step = matchStep(secret, code, Date.now(), null);
  if (step === null) throw codeInvalid();

  const recoveryCodes = newRecoveryCodes(RECOVERY_CODE_COUNT);
  const enabled = await withTransaction(async (trx) => {
    const done = await staffAuthRepo.enableTotp(trx, {
      staffId: account.id,
      step,
      recoveryHashes: recoveryCodes.map(recoveryHash),
    });
    if (done) {
      await staffAuthRepo.recordSecurityChange(trx, {
        actorStaffId: account.id,
        hospitalId: account.hospitalId,
        staffId: account.id,
        change: 'two_factor_enabled',
        ip: client.ip,
        userAgent: client.userAgent === null ? null : client.userAgent.slice(0, 300),
      });
    }
    return done;
  });
  if (!enabled) throw new AppError('AUTH_2FA_ALREADY_ON');

  await staffAuthRepo.revokeOtherSessions(account.id, null);
  const updated = await accountOf(account.id);
  return {
    recoveryCodes,
    session: await issue(updated, await rolesOrRefuse(updated), client),
  };
}

/**
 * `pnpm staff:reset-2fa` — for a facility's only administrator, whose phone
 * and recovery codes are both gone, so nobody is left to reset it from
 * `S-B-11`. Run by platform staff on the server, audited with no actor.
 * Returns the account's name, or null when no account matches.
 */
export async function resetTwoFactorFromServer(input: {
  readonly email: string;
  readonly hospitalCode: string | null;
}): Promise<{ readonly fullName: string; readonly hospitalCode: string | null } | null> {
  const accounts = await staffAuthRepo.findByEmail(input.email, input.hospitalCode);
  if (accounts.length > 1) {
    throw new Error(`${input.email} has accounts at more than one facility; give --hospital-code.`);
  }
  const account = accounts[0];
  if (account === undefined) return null;
  await withTransaction(async (trx) => {
    await staffAuthRepo.clearTwoFactor(account.id, trx);
    await staffAuthRepo.recordSecurityChange(trx, {
      actorStaffId: null,
      hospitalId: account.hospitalId,
      staffId: account.id,
      change: 'two_factor_reset_from_server',
      ip: null,
      userAgent: null,
    });
  });
  await staffAuthRepo.revokeOtherSessions(account.id, null);
  return { fullName: account.fullName, hospitalCode: account.hospitalCode };
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
  const roles = await staffAuthRepo.rolesOf(account.id, account.hospitalId);
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
    roles,
    mustChangePassword: account.mustChangePassword,
    twoFactor: twoFactorOf(account, roles),
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
 * Creates a platform administrator: the account that brings hospitals on
 * (`S-B-12`, `FR-ONB-*`).
 *
 * `pnpm staff:create --platform`. A deployment's first one has to come from
 * the command line, for the reason a hospital's first administrator once did:
 * nobody can make one from a screen until one exists. After it, hospitals and
 * their administrators are made on `S-B-12` and no command is needed.
 *
 * It belongs to no facility (`FR-ROLE-01`, 0024). Its temporary password is
 * changed at first sign-in, and it sets up two-step verification before any
 * console opens (`FR-SEC-10`).
 */
export async function createPlatformAdministrator(input: {
  readonly email: string;
  readonly fullName: string;
}): Promise<{ readonly staffId: string; readonly temporaryPassword: string }> {
  if (await staffAuthRepo.nationalEmailTaken(input.email)) {
    throw new Error(`${input.email} already has a platform account.`);
  }

  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);

  return await withTransaction(async (trx) => {
    const staffId = await staffAuthRepo.createStaffAccount(trx, {
      hospitalId: null,
      email: input.email,
      fullName: input.fullName,
      staffCode: null,
      passwordHash,
      createdBy: null,
    });
    await staffAuthRepo.grantRole(trx, { staffId, hospitalId: null, role: 'platform_admin' });
    return { staffId, temporaryPassword: password };
  });
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
