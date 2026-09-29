/**
 * A patient signs in with their phone and a one-time code, and takes over what
 * that number already holds (pilot step 25, `S-A-03`, `S-A-04`, `S-A-20`,
 * `FR-PAT-01`, `FR-PAT-04`, `FR-GST-09`, `FR-IMP-10`, `FR-SEC-05`).
 *
 * ## The code
 *
 * Six digits, alive for `OTP_TTL_SECONDS`, one open per number (a new one
 * replaces the old). At most `OTP_MAX_PER_HOUR` sent to a number an hour;
 * five wrong entries spend the code and lock the number for fifteen minutes.
 * Only a keyed hash is stored, and the code is never logged (CLAUDE.md §7) —
 * not even by the log SMS provider, which masks it.
 *
 * **On a demonstration** (`DEMO_MODE`) the code also comes back in the
 * response, so a demo can be walked through without a handset. `DEMO_MODE`
 * and `NODE_ENV=production` refuse to boot together (`env.ts`), so a real
 * deployment can never answer with a code.
 *
 * ## The session
 *
 * The same shape staff sign-in has (step 21): a fifteen-minute access token
 * (`kind: 'patient'`) and an opaque refresh token that rotates on every use,
 * stored hashed in `sessions_auth`. A refresh token used twice means two
 * parties hold it, and every session of the account ends. The device that
 * signed in is recorded with the session (`FR-SEC-05`: device binding), and a
 * refresh from another device is refused.
 *
 * ## Claiming
 *
 * A number that booked as a guest, or that a hospital imported, holds
 * patients no account owns. After sign-in they are listed (`S-A-20`) and taken
 * over in one confirmation (`FR-GST-09`): records follow the patient, so the
 * wallet then shows them. Only the account's own verified number is claimed —
 * never a number typed in.
 */

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { normaliseBdMobile } from '@platform/domain';

import { sms } from '../adapters/sms.js';
import { durationMs, signToken } from '../config/jwt.js';
import { logger } from '../config/logger.js';
import { env } from '../env.js';
import { AppError, validationFailed } from '../errors/AppError.js';
import * as repo from '../repositories/patientAuth.repo.js';
import { withTransaction } from '../repositories/transaction.js';

/** Wrong codes before the number is locked (`S-A-04`). */
export const MAX_CODE_ATTEMPTS = 5;
/** How long the lock lasts. */
export const CODE_LOCK_MINUTES = 15;
/** How long before the screen offers to send again (`S-A-04`). */
export const RESEND_AFTER_SECONDS = 60;

export interface Client {
  readonly ip: string | null;
  readonly device: string | null;
}

export interface PatientSession {
  readonly access: string;
  readonly refresh: string;
  readonly accessExpiresAt: string;
  readonly user: { readonly id: string; readonly phone: string };
  readonly isNew: boolean;
  /** How many patients this number holds that no account owns yet (`S-A-20`). */
  readonly claimable: number;
}

function phoneOf(typed: string): string {
  const phone = normaliseBdMobile(typed);
  if (phone === null) throw validationFailed({ field: 'phone', reason: 'not_bd_mobile' });
  return phone;
}

/** A keyed hash, so a copied table cannot be tried against a million codes offline. */
function codeHash(phone: string, code: string): string {
  return createHmac('sha256', env.JWT_REFRESH_SECRET).update(`${phone}:${code}`).digest('hex');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The device a session belongs to: its user agent, cut to a sane length. */
function deviceOf(client: Client): string | null {
  return client.device === null ? null : client.device.slice(0, 300);
}

// ---------------------------------------------------------------------------
// The code (POST /auth/otp, POST /auth/verify)
// ---------------------------------------------------------------------------

export async function requestCode(
  typedPhone: string,
  client: Client,
): Promise<{ ttlSeconds: number; resendAfterSeconds: number; demoCode?: string }> {
  const phone = phoneOf(typedPhone);

  const locked = await repo.lockedUntil(phone);
  if (locked !== null)
    throw new AppError('AUTH_LOCKED', { details: { until: locked.toISOString() } });
  if ((await repo.sentInLastHour(phone)) >= env.OTP_MAX_PER_HOUR) {
    throw new AppError('AUTH_OTP_RATE_LIMIT', { details: { perHour: env.OTP_MAX_PER_HOUR } });
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const challengeId = await repo.createChallenge({
    phone,
    codeHash: codeHash(phone, code),
    expiresAt: new Date(Date.now() + env.OTP_TTL_SECONDS * 1000),
    ip: client.ip,
  });

  // The code first and in Latin digits, where a phone's autofill looks for it.
  const minutes = Math.round(env.OTP_TTL_SECONDS / 60);
  const sent = await sms().send({
    to: phone,
    body: `${code} — HealthWealthBD যাচাই কোড। ${String(minutes)} মিনিট পর্যন্ত কাজ করবে। কাউকে বলবেন না।`,
    notificationId: challengeId,
    templateKey: 'auth.otp',
    sensitive: true,
  });
  if (!sent.ok) logger.warn({ challengeId, error: sent.error }, 'sign-in code not sent');

  return {
    ttlSeconds: env.OTP_TTL_SECONDS,
    resendAfterSeconds: RESEND_AFTER_SECONDS,
    ...(env.DEMO_MODE ? { demoCode: code } : {}),
  };
}

export async function verify(
  typedPhone: string,
  code: string,
  client: Client,
): Promise<PatientSession> {
  const phone = phoneOf(typedPhone);
  await checkCode(phone, code);
  const user = await repo.signInUser(phone);
  return await issue({ id: user.id, phone }, user.isNew, client);
}

/**
 * Proves a code against the number's open challenge, once. Shared by an
 * account's sign-in and a guest's phone check: one code, one lock, one rate.
 */
async function checkCode(phone: string, code: string): Promise<void> {
  const locked = await repo.lockedUntil(phone);
  if (locked !== null)
    throw new AppError('AUTH_LOCKED', { details: { until: locked.toISOString() } });

  const challenge = await repo.openChallenge(phone);
  if (challenge === null || challenge.expiresAt.getTime() <= Date.now()) {
    throw new AppError('AUTH_OTP_INVALID', { details: { reason: 'expired' } });
  }
  if (!sameHash(codeHash(phone, code), challenge.codeHash)) {
    const wrong = await repo.recordWrongCode(challenge.id, MAX_CODE_ATTEMPTS, CODE_LOCK_MINUTES);
    if (wrong.lockedUntil !== null) {
      throw new AppError('AUTH_LOCKED', { details: { until: wrong.lockedUntil.toISOString() } });
    }
    throw new AppError('AUTH_OTP_INVALID', {
      details: { reason: 'wrong', attemptsLeft: MAX_CODE_ATTEMPTS - wrong.attempts },
    });
  }
  // Two taps racing with the same code: one signs in.
  if (!(await repo.consume(challenge.id))) {
    throw new AppError('AUTH_OTP_INVALID', { details: { reason: 'used' } });
  }
}

async function issue(
  user: { id: string; phone: string },
  isNew: boolean,
  client: Client,
): Promise<PatientSession> {
  const accessTtl = durationMs(env.JWT_ACCESS_TTL);
  const access = await signToken({ kind: 'access', claims: { sub: user.id, kind: 'patient' } });
  const secret = randomBytes(32).toString('base64url');
  const sessionId = await repo.createSession({
    userId: user.id,
    tokenHash: sha256(secret),
    expiresAt: new Date(Date.now() + durationMs(env.JWT_REFRESH_TTL)),
    ip: client.ip,
    device: deviceOf(client),
  });
  const claimable = (await repo.claimableFor(user.phone)).length;
  return {
    access,
    refresh: `${sessionId}.${secret}`,
    accessExpiresAt: new Date(Date.now() + accessTtl).toISOString(),
    user,
    isNew,
    claimable,
  };
}

// ---------------------------------------------------------------------------
// The session (POST /auth/refresh, POST /auth/logout)
// ---------------------------------------------------------------------------

const refreshInvalid = (reason: string): AppError =>
  new AppError('AUTH_TOKEN_INVALID', { details: { reason } });

function parseRefresh(token: string): { id: string; secret: string } | null {
  const [id, secret, extra] = token.split('.');
  if (id === undefined || secret === undefined || extra !== undefined) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id) || secret.length < 20) return null;
  return { id, secret };
}

export async function refresh(token: string, client: Client): Promise<PatientSession> {
  const parsed = parseRefresh(token);
  if (parsed === null) throw refreshInvalid('malformed');
  const session = await repo.findSession(parsed.id);
  if (session === null || !sameHash(sha256(parsed.secret), session.tokenHash))
    throw refreshInvalid('unknown');
  if (session.revokedAt !== null) {
    await repo.revokeAllSessions(session.userId);
    logger.warn({ userId: session.userId }, 'patient refresh token reused; sessions revoked');
    throw refreshInvalid('reused');
  }
  if (session.expiresAt.getTime() <= Date.now()) throw refreshInvalid('expired');
  // Bound to the device that signed in (FR-SEC-05): a token carried elsewhere is refused.
  if (session.device !== null && session.device !== deviceOf(client)) {
    await repo.revokeSession(session.id);
    throw refreshInvalid('device');
  }
  const user = await repo.userById(session.userId);
  if (user === null) throw refreshInvalid('account');
  if (!(await repo.revokeSession(session.id))) throw refreshInvalid('raced');
  return await issue(user, false, client);
}

export async function logout(token: string): Promise<void> {
  const parsed = parseRefresh(token);
  if (parsed === null) return;
  const session = await repo.findSession(parsed.id);
  if (session === null || !sameHash(sha256(parsed.secret), session.tokenHash)) return;
  await repo.revokeSession(session.id);
}

// ---------------------------------------------------------------------------
// Profiles and claiming (GET /me/profiles, POST /guest/claim)
// ---------------------------------------------------------------------------

export async function profiles(userId: string): Promise<repo.ProfileRow[]> {
  return await repo.profilesOf(userId);
}

/**
 * Without `confirm`, what the account's number holds (`S-A-20`'s preview);
 * with it, takes it all over at once (`FR-GST-09`).
 */
export async function claim(
  userId: string,
  confirm: boolean,
): Promise<{ claimable: Awaited<ReturnType<typeof repo.claimableFor>>; claimed: number }> {
  const user = await repo.userById(userId);
  if (user === null) throw new AppError('AUTH_TOKEN_INVALID', { details: { reason: 'account' } });
  if (!confirm) return { claimable: await repo.claimableFor(user.phone), claimed: 0 };
  const claimed = await withTransaction(async (trx) => {
    const moved = await repo.claim(trx, { userId, phone: user.phone });
    if (moved > 0) await repo.auditClaim(trx, { userId, moved });
    return moved;
  });
  return { claimable: [], claimed };
}

// ---------------------------------------------------------------------------
// A guest's one phone check (POST /guest/start, /guest/verify, FR-GST-03/04/12)
// ---------------------------------------------------------------------------

/**
 * Whether a guest booking must prove its phone first (`FR-GST-03`: money and
 * an SMS thread follow a booking). On by default everywhere but a
 * demonstration, which keeps its one-tap booking the way it keeps its
 * password-less console picker (CLAUDE.md §4.1); `GUEST_BOOKING_OTP` says
 * otherwise either way.
 */
export function guestPhoneCheckRequired(): boolean {
  return env.GUEST_BOOKING_OTP ?? !env.DEMO_MODE;
}

async function guestTokenFor(identityId: string): Promise<string> {
  return await signToken({ kind: 'access', claims: { sub: identityId, kind: 'guest' } });
}

/**
 * `MOD-A07-GUEST`'s next step. A number that has already proved itself is not
 * asked again (`FR-GST-12`); a new one is sent a code; with the check off,
 * nothing is needed.
 */
export async function startGuest(
  typedPhone: string,
  name: string,
  client: Client,
): Promise<
  | { needsOtp: false; guestToken: string | null }
  | { needsOtp: true; ttlSeconds: number; resendAfterSeconds: number; demoCode?: string }
> {
  const phone = phoneOf(typedPhone);
  if (!guestPhoneCheckRequired()) return { needsOtp: false, guestToken: null };
  const known = await repo.verifiedGuest(phone);
  if (known !== null) return { needsOtp: false, guestToken: await guestTokenFor(known) };
  void name;
  return { needsOtp: true, ...(await requestCode(phone, client)) };
}

/**
 * `MOD-GST-OTP`: the code proves the number, and the answer is a guest token
 * for it. No account is made and nothing more is asked (`FR-GST-04`).
 */
export async function verifyGuest(
  typedPhone: string,
  code: string,
  name: string,
): Promise<{ guestToken: string }> {
  const phone = phoneOf(typedPhone);
  await checkCode(phone, code);
  const identityId = await repo.markGuestVerified(phone, name);
  return { guestToken: await guestTokenFor(identityId) };
}

/**
 * The booking's half: a guest booking names a phone, and with the check on
 * the caller must hold a guest token for that same number.
 */
export async function assertGuestPhoneProven(
  principal: { readonly kind: string; readonly id: string } | undefined,
  typedPhone: string,
): Promise<void> {
  if (!guestPhoneCheckRequired()) return;
  const phone = phoneOf(typedPhone);
  const identity = await repo.verifiedGuest(phone);
  if (principal?.kind !== 'guest' || identity === null || identity !== principal.id) {
    throw new AppError('AUTH_REQUIRED', { details: { reason: 'phone_unverified' } });
  }
}
