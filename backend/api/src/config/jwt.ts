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

import { env } from '../env.js';

/** Which secret a token is signed with, and therefore what it may authorise. */
export type TokenKind = 'access' | 'refresh' | 'guest';

const ISSUER = 'healthcare-api';

const encoder = new TextEncoder();

const SECRETS: Record<TokenKind, Uint8Array> = {
  access: encoder.encode(env.JWT_ACCESS_SECRET),
  refresh: encoder.encode(env.JWT_REFRESH_SECRET),
  guest: encoder.encode(env.GUEST_LINK_SECRET),
};

const AUDIENCES: Record<TokenKind, string> = {
  access: 'access',
  refresh: 'refresh',
  guest: 'guest-link',
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
