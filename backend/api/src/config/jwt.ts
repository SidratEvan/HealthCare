/**
 * Token signing and verification (BACKEND.md §0: JWT access 15 min + refresh
 * 30 days).
 *
 * Infrastructure, alongside the pool and the logger, because three different
 * consumers need it: the auth middleware verifies an access token, the guest
 * middleware verifies a tracking-link token, and `auth.service` mints both.
 *
 * Three separate secrets, never interchangeable:
 *
 *   access   15 minutes, carried on every request
 *   refresh  30 days, exchanged only at `/auth/refresh`
 *   guest    a tracking link that reaches a patient by SMS and is scoped to
 *            one booking (FR-GST-05)
 *
 * They are separate because the blast radius differs by orders of magnitude. A
 * leaked access token expires over lunch; a leaked refresh token is a month of
 * someone's medical records. `env.ts` refuses to start in production if the
 * access and refresh secrets are equal, which would collapse that distinction.
 */

import { jwtVerify, SignJWT, type JWTPayload } from 'jose';

import { CONSENT_OFFER_TTL_SECONDS } from '@platform/domain';

import { env } from '../env.js';

/** Which secret a token is signed with, and therefore what it may authorise. */
export type TokenKind =
  | 'access'
  | 'refresh'
  | 'guest'
  | 'consent'
  | 'bed_request'
  | 'emergency_case'
  | 'standby'
  | 'staff_2fa'
  | 'guest_device';

const ISSUER = 'healthcare-api';

const encoder = new TextEncoder();

const SECRETS: Record<TokenKind, Uint8Array> = {
  access: encoder.encode(env.JWT_ACCESS_SECRET),
  refresh: encoder.encode(env.JWT_REFRESH_SECRET),
  guest: encoder.encode(env.GUEST_LINK_SECRET),

  /**
   * A consent offer reuses the guest-link secret, and is separated from it by
   * **audience** rather than by key (`FR-PAT-63`).
   *
   * A fourth secret would be a fourth environment variable, and an API that
   * will not boot without one it has never been given is a worse failure than
   * the one this avoids: the deployed demo would stop the moment this shipped.
   *
   * The separation is real either way, because the audience is signed. A
   * tracking link presented as a consent code fails `jwtVerify`'s audience
   * check, and so does a consent code presented as a tracking link or as a
   * bearer token — `attachPrincipal` only ever verifies against `access`.
   */
  consent: encoder.encode(env.GUEST_LINK_SECRET),

  // The same arrangement for a bed request's status link (`FR-PAT-52`): the
  // guest-link secret, a different signed audience. A status link cannot be
  // replayed as a tracking link, a consent code or a bearer token.
  bed_request: encoder.encode(env.GUEST_LINK_SECRET),

  // And for the family's view of an emergency alert they sent (`S-A-10c`):
  // scoped to one case, useless as anything else.
  emergency_case: encoder.encode(env.GUEST_LINK_SECRET),

  // And for a place on a standby list (`FR-PAT-27`): the link a patient
  // answers an offer from. One row, useless as a tracking link or a bearer.
  standby: encoder.encode(env.GUEST_LINK_SECRET),

  // Between a right password and the second factor (pilot step 28,
  // `POST /staff/2fa`): the access secret, a different signed audience, so the
  // challenge cannot be presented as a bearer token — `attachPrincipal`
  // verifies only `access` — and opens nothing but the code check.
  staff_2fa: encoder.encode(env.JWT_ACCESS_SECRET),

  // A phone that proved itself, kept by the device it proved itself on
  // (decision 85, `APP_FLOW.md` A1: "bound to phone + device"): the guest-link
  // secret, its own audience. It opens nothing but `POST /guest/start`'s
  // skip of the code, and only on the device and for the number it names.
  guest_device: encoder.encode(env.GUEST_LINK_SECRET),
};

const AUDIENCES: Record<TokenKind, string> = {
  access: 'access',
  refresh: 'refresh',
  guest: 'guest-link',
  consent: 'consent-offer',
  bed_request: 'bed-request',
  emergency_case: 'emergency-case',
  standby: 'standby',
  staff_2fa: 'staff-2fa',
  guest_device: 'guest-device',
};

/**
 * What a signed token asserts.
 *
 * Deliberately small. A token says who the bearer is and, for staff, which
 * hospital and roles — nothing that could go stale in a way that matters. A
 * patient's name is not in here, both because it would leak in every log that
 * captured a header and because a token is not a profile.
 */
export interface TokenClaims extends JWTPayload {
  /** Subject: a user id, a guest id, or a staff user id. */
  sub: string;
  kind: 'patient' | 'guest' | 'staff';
  /** Present for staff only (FR-ROLE-01). */
  hospitalId?: string;
  /** Present for staff only. */
  roles?: readonly string[];
  /** Present for a guest tracking link: the one booking it may see. */
  bookingId?: string;
  /** Present for a bed request's status link: the one request it may see. */
  bedRequestId?: string;
  /** Present for an emergency alert's status link: the one case it may see. */
  emergencyCaseId?: string;
  /** Present for a standby status link: the one place on a list it may act on. */
  standbyId?: string;
  /**
   * Present on a guest device proof: a hash of the device it was issued to,
   * compared on use, as a patient's refresh session is (`FR-SEC-05`).
   */
  dev?: string;
  /**
   * Set on a staff access token issued while `must_change_password` holds
   * (0027): `attachPrincipal` then admits it to the password change and
   * nothing else.
   */
  mcp?: boolean;
  /**
   * Set on a staff access token for an account that must have a second factor
   * and has none yet (pilot step 28, `FR-SEC-10`): `attachPrincipal` then
   * admits it to setting one up and nothing else.
   */
  tfa?: 'setup';
}

export interface SignOptions {
  readonly kind: TokenKind;
  readonly claims: Omit<TokenClaims, 'iss' | 'aud' | 'iat' | 'exp'>;
  /** Overrides the default lifetime for this token kind. */
  readonly expiresIn?: string;
}

function defaultLifetime(kind: TokenKind): string {
  switch (kind) {
    case 'access':
      return env.JWT_ACCESS_TTL;
    case 'refresh':
      return env.JWT_REFRESH_TTL;
    case 'guest':
      return `${String(env.GUEST_LINK_TTL_DAYS)}d`;
    case 'consent':
      // Minutes, not days. The code is shown on a screen in a chamber and is
      // finished the moment the doctor has typed it; one that stayed live for
      // an hour would still be live in a photograph of that screen.
      return `${String(CONSENT_OFFER_TTL_SECONDS)}s`;
    case 'bed_request':
      // As long as a guest tracking link. A request is answered in hours, but
      // the family keeps the SMS, and "your request was declined" is worth
      // being able to read the next morning.
      return `${String(env.GUEST_LINK_TTL_DAYS)}d`;
    case 'emergency_case':
      // A day. An emergency is over in hours, and the link is only for
      // following one journey to one ER — a case token that outlived the
      // night would be a stranger's alert readable from an old SMS.
      return '24h';
    case 'standby':
      // As long as a tracking link: an offer can come at the end of the
      // chamber, and a seated patient opens their serial from this link.
      return `${String(env.GUEST_LINK_TTL_DAYS)}d`;
    case 'staff_2fa':
      // Long enough to find the phone and open the app, short enough that a
      // password typed on a shared counter is not a standing half of a login.
      return '5m';
    case 'guest_device':
      // A follow-up visit is weeks or months away, and each use hands back a
      // fresh one, so a phone in use stays proved; one put away for a season
      // is asked for a code again. A judgement, recorded in STATUS (decision 85).
      return '90d';
  }
}

export async function signToken({ kind, claims, expiresIn }: SignOptions): Promise<string> {
  return await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCES[kind])
    .setIssuedAt()
    .setExpirationTime(expiresIn ?? defaultLifetime(kind))
    .sign(SECRETS[kind]);
}

export type VerifyResult =
  | { readonly ok: true; readonly claims: TokenClaims }
  | { readonly ok: false; readonly reason: 'expired' | 'malformed' | 'wrong_audience' | 'invalid' };

/**
 * Verifies a token against exactly one secret and audience.
 *
 * The audience check is what stops a refresh token being presented as an
 * access token: both are signed JWTs from the same issuer, and without it a
 * 30-day credential would be accepted wherever a 15-minute one is.
 *
 * Returns a reason rather than throwing, because the caller has to decide
 * between a 401 that prompts a refresh and a 401 that forces a login.
 */
export async function verifyToken(token: string, kind: TokenKind): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, SECRETS[kind], {
      issuer: ISSUER,
      audience: AUDIENCES[kind],
      algorithms: ['HS256'],
    });

    const sub = payload.sub;
    const claimKind = payload['kind'];

    if (typeof sub !== 'string' || !isPrincipalKind(claimKind)) {
      return { ok: false, reason: 'malformed' };
    }

    return { ok: true, claims: { ...payload, sub, kind: claimKind } };
  } catch (error) {
    return { ok: false, reason: classify(error) };
  }
}

function isPrincipalKind(value: unknown): value is TokenClaims['kind'] {
  return value === 'patient' || value === 'guest' || value === 'staff';
}

function classify(error: unknown): Exclude<VerifyResult, { ok: true }>['reason'] {
  if (error instanceof Error) {
    // jose sets a stable `code` on its errors; matching on it rather than on
    // the message keeps this working across library versions.
    const code = (error as { code?: unknown }).code;
    if (code === 'ERR_JWT_EXPIRED') return 'expired';
    if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') return 'wrong_audience';
    if (code === 'ERR_JWS_INVALID' || code === 'ERR_JWT_INVALID') return 'malformed';
  }
  return 'invalid';
}

/** A TTL in the form the env accepts (`15m`, `24h`, `30d`), in milliseconds. */
export function durationMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (match === null) throw new Error(`Not a duration: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2];
  const scale =
    unit === 's' ? 1_000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return amount * scale;
}
