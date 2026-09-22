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
  'access' | 'refresh' | 'guest' | 'consent' | 'bed_request' | 'emergency_case';

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
};

const AUDIENCES: Record<TokenKind, string> = {
  access: 'access',
  refresh: 'refresh',
  guest: 'guest-link',
  consent: 'consent-offer',
  bed_request: 'bed-request',
  emergency_case: 'emergency-case',
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
