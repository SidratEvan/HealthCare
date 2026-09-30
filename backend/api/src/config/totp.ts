/**
 * The staff second factor (pilot step 28, FR-SEC-10, BACKEND.md §0).
 *
 * A six-digit code from an authenticator app — TOTP, RFC 6238: HMAC-SHA-1 over
 * the 30-second step, six digits, which is what every such app (Google
 * Authenticator, Microsoft Authenticator, Authy, a password manager) does by
 * default. From `node:crypto`, like the password hash, so no dependency is
 * added for it (CLAUDE.md §7).
 *
 * ## What is stored, and how
 *
 * The shared secret must be readable by the server — it computes the same code
 * the phone does — so it cannot be hashed like a password. It is encrypted
 * (AES-256-GCM) with a key the database does not hold, `TOTP_ENCRYPTION_KEY`,
 * so a copy of the database alone, a backup included, cannot mint codes.
 * The sealed form names its version (`v1.`), so the scheme can change later
 * without a migration.
 *
 * Recovery codes are the opposite case: nobody needs them back, so only an
 * HMAC of each is kept, keyed from the same secret. Twelve characters from a
 * 31-letter alphabet is about 59 bits each — and without the key, a stolen
 * table of their hashes cannot be searched at all.
 *
 * Outside production a blank key is derived from `JWT_REFRESH_SECRET`, so a
 * development machine and the pitch demo need nothing new (`env.ts`).
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

import { env } from '../env.js';

/** RFC 6238 as every authenticator app reads it by default. */
export const TOTP = { digits: 6, periodSeconds: 30, algorithm: 'SHA1' } as const;

/**
 * How many steps either side of now a code is accepted for: a phone's clock a
 * little off, or a code typed as it rolled over. One each way is RFC 6238's
 * recommendation, and ninety seconds in all.
 */
const WINDOW_STEPS = 1;

/** 160 bits, the HMAC-SHA-1 block the RFC recommends (RFC 4226 §4). */
const SECRET_BYTES = 20;

// --- Base32 (RFC 4648), which is how a secret reaches an app ---------------------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Case-insensitive, spaces and padding ignored. Throws on anything else. */
export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error('not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// --- Codes ----------------------------------------------------------------------

/** A new secret, as base32 — the form an app is given. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/** The 30-second step a moment falls in. */
export function stepAt(ms: number): number {
  return Math.floor(ms / 1_000 / TOTP.periodSeconds);
}

/** The code for one step (RFC 4226 §5.3, with the step as the counter). */
export function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** TOTP.digits).padStart(TOTP.digits, '0');
}

function sameCode(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The step a code belongs to, if it is within the window of `now` and later
 * than `lastStep` — or null. The caller records the step it accepted, so the
 * same code cannot be used twice: once read over a shoulder, it is spent.
 */
export function matchStep(
  secret: string,
  code: string,
  now: number,
  lastStep: number | null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepAt(now);
  for (let offset = -WINDOW_STEPS; offset <= WINDOW_STEPS; offset += 1) {
    const step = current + offset;
    if (lastStep !== null && step <= lastStep) continue;
    if (sameCode(codeAt(secret, step), code)) return step;
  }
  return null;
}

/**
 * What the QR code carries (the Key Uri Format every app reads). The issuer is
 * what the app lists the entry under, so a person with accounts at two
 * facilities can tell them apart.
 */
export function otpauthUri(input: {
  readonly secret: string;
  readonly account: string;
  readonly issuer: string;
}): string {
  // A colon separates issuer from account in the label; keep it out of both.
  const issuer = input.issuer.replace(/:/g, ' ').trim();
  const account = input.account.replace(/:/g, ' ').trim();
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: TOTP.algorithm,
    digits: String(TOTP.digits),
    period: String(TOTP.periodSeconds),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

// --- Keys -----------------------------------------------------------------------

let cachedFor: string | null = null;
let cached: { readonly seal: Buffer; readonly recovery: Buffer } | null = null;

/** Two keys from the one secret: one seals the TOTP secret, one keys the recovery hashes. */
function keys(): { readonly seal: Buffer; readonly recovery: Buffer } {
  const own = env.TOTP_ENCRYPTION_KEY !== '';
  const material = own ? env.TOTP_ENCRYPTION_KEY : env.JWT_REFRESH_SECRET;
  const cacheKey = `${own ? 'own' : 'derived'}:${material}`;
  if (cached !== null && cachedFor === cacheKey) return cached;
  const context = own ? 'staff-totp' : 'staff-totp-derived';
  const derive = (purpose: string): Buffer =>
    Buffer.from(hkdfSync('sha256', material, Buffer.alloc(0), `${context}:${purpose}:v1`, 32));
  cached = { seal: derive('seal'), recovery: derive('recovery') };
  cachedFor = cacheKey;
  return cached;
}

/** Encrypts a secret for `staff_users.totp_secret`. */
export function sealSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys().seal, iv);
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv, tag, body]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/**
 * Decrypts what `sealSecret` wrote. Throws on anything altered or sealed with
 * another key — a secret that does not open is one no code can match, never
 * one to fall back from.
 */
export function openSecret(sealed: string): string {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || iv === undefined || tag === undefined || body === undefined) {
    throw new Error('not a sealed TOTP secret');
  }
  const decipher = createDecipheriv('aes-256-gcm', keys().seal, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(body, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

// --- Recovery codes -------------------------------------------------------------

/** No 0/o, 1/l/i: a code copied from paper by hand should not be ambiguous. */
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const RECOVERY_LENGTH = 12;
export const RECOVERY_CODE_COUNT = 10;

/** Ten codes, `xxxx-xxxx-xxxx`, shown once. */
export function newRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    let code = '';
    for (let i = 0; i < RECOVERY_LENGTH; i += 1) {
      code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    }
    return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
  });
}

/** A recovery code as typed — any case, with or without hyphens or spaces — or null. */
export function normaliseRecoveryCode(typed: string): string | null {
  const clean = typed.toLowerCase().replace(/[\s-]/g, '');
  if (clean.length !== RECOVERY_LENGTH) return null;
  return [...clean].every((char) => RECOVERY_ALPHABET.includes(char)) ? clean : null;
}

/** What `staff_users.totp_recovery_hashes` holds for one code. */
export function recoveryHash(code: string): string {
  const normal = normaliseRecoveryCode(code) ?? code;
  return createHmac('sha256', keys().recovery).update(normal).digest('hex');
}
