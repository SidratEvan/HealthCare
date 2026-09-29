/**
 * Staff password hashing (FR-SEC-06, CLAUDE.md §4.1, BACKEND.md §0).
 *
 * scrypt from `node:crypto`, not Argon2id: Argon2id is a native dependency and
 * CLAUDE.md §7 asks before any new one, while scrypt at OWASP's minimum is in
 * the runtime already. The parameters are OWASP's floor for scrypt — N = 2^17,
 * r = 8, p = 1 — which costs about 128 MiB and a few hundred milliseconds per
 * hash: slow enough that a stolen table is expensive to guess against, fast
 * enough that a receptionist does not notice.
 *
 * The stored form describes itself — `scrypt$<N>$<r>$<p>$<salt>$<hash>`, both
 * base64 — so raising the cost later needs no migration: a verifier reads the
 * parameters it was hashed with, and `needsRehash` says when to upgrade one at
 * the next successful login.
 *
 * Anything else in the column verifies nothing. The seeds write a `!disabled`
 * placeholder for accounts that must not sign in, and a malformed value is
 * treated the same way rather than as an error, so a bad row can lock one
 * person out but cannot open anything.
 */

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

const PREFIX = 'scrypt';

/** OWASP's minimum for scrypt. Raising any of these is safe; see `needsRehash`. */
export const SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1 } as const;

const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** The shortest password staff may choose (`AUTH_PASSWORD_WEAK`). */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * Node refuses a derivation whose memory need (128 · N · r bytes) exceeds
 * `maxmem`, which defaults to 32 MiB — a quarter of what N = 2^17 needs.
 */
function maxmemFor(N: number, r: number): number {
  return 128 * N * r + 1024 * 1024;
}

async function derive(
  password: string,
  salt: Buffer,
  params: { readonly N: number; readonly r: number; readonly p: number },
): Promise<Buffer> {
  const options: ScryptOptions = { ...params, maxmem: maxmemFor(params.N, params.r) };
  return await new Promise((resolve, reject) => {
    scryptCallback(password.normalize('NFKC'), salt, KEY_BYTES, options, (error, key) => {
      if (error === null) resolve(key);
      else reject(error);
    });
  });
}

/** Hashes a password for `staff_users.password_hash`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return [
    PREFIX,
    String(N),
    String(r),
    String(p),
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

interface Parsed {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Buffer;
  readonly key: Buffer;
}

function parse(stored: string): Parsed | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;
  const [, n, r, p, salt, key] = parts;
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (![N, R, P].every((value) => Number.isInteger(value) && value > 0)) return null;
  // N must be a power of two above 1, or scrypt throws.
  if (N < 2 || (N & (N - 1)) !== 0) return null;
  if (salt === undefined || key === undefined || salt === '' || key === '') return null;
  return { N, r: R, p: P, salt: Buffer.from(salt, 'base64'), key: Buffer.from(key, 'base64') };
}

/**
 * True when `password` is the one `stored` was made from.
 *
 * Constant-time on the comparison. A stored value that is not a scrypt hash
 * (the seeds' `!disabled` placeholder, an empty string) answers false without
 * deriving anything.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (stored === null) return false;
  const parsed = parse(stored);
  if (parsed === null || parsed.key.length === 0) return false;
  const candidate = await derive(password, parsed.salt, parsed);
  return candidate.length === parsed.key.length && timingSafeEqual(candidate, parsed.key);
}

/** True when a hash was made with weaker parameters than today's. */
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored);
  if (parsed === null) return false;
  return parsed.N < SCRYPT_PARAMS.N || parsed.r < SCRYPT_PARAMS.r || parsed.p < SCRYPT_PARAMS.p;
}

/**
 * Work done for an account that does not exist, so a wrong email takes as long
 * as a wrong password and the response time cannot be used to find out which
 * addresses have accounts (`AUTH_INVALID_CREDENTIALS`).
 */
let decoy: Promise<string> | null = null;
export async function burnVerification(password: string): Promise<void> {
  decoy ??= hashPassword('decoy-password-never-matches');
  await verifyPassword(password, await decoy);
}

/** Why a new password is refused, or null when it is acceptable. */
export function passwordProblem(next: string, current?: string): 'too_short' | 'unchanged' | null {
  if ([...next.normalize('NFKC')].length < MIN_PASSWORD_LENGTH) return 'too_short';
  if (next.normalize('NFKC') === current?.normalize('NFKC')) return 'unchanged';
  return null;
}

const TEMPORARY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/**
 * A temporary password for an administrator to hand over: 14 characters, no
 * look-alikes (no 0/O, 1/l/I). Bytes at or above the largest multiple of the
 * alphabet's length are thrown away, so every character is equally likely.
 */
export function temporaryPassword(length = 14): string {
  const size = TEMPORARY_ALPHABET.length;
  const limit = 256 - (256 % size);
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < limit && out.length < length) out += TEMPORARY_ALPHABET.charAt(byte % size);
    }
  }
  return out;
}
