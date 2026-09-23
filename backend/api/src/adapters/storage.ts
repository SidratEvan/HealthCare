/**
 * The file store (BACKEND.md §0, §2: "Supabase Storage — signed URLs only").
 *
 * One thing uses it in this version: a lab uploading a report (`FR-LAB-03`).
 * `BTN-A12-UPLOAD` (paper records) will be the second.
 *
 * ## `STORAGE_PROVIDER=mock` is the implementation, not a placeholder
 *
 * CLAUDE.md §1.1, the same standing `SMS_PROVIDER=log` and
 * `PAYMENT_PROVIDER=mock` have. `SUPABASE_SERVICE_ROLE_KEY` is deliberately
 * unset in this repository, and a half-configured bucket would fail at the
 * moment a demo uploaded a report rather than at boot. The mock keeps the
 * bytes in this process and hands back a URL this API itself serves, so the
 * whole of `FR-LAB-03` — upload, deliver, patient opens it — is real and
 * end-to-end; only the disk is not.
 *
 * It is refused in production (`env.ts`): a store that loses every report on
 * restart is fine for a pitch and not for a hospital.
 *
 * ## Signed URLs, in both implementations
 *
 * "Signed URLs only" is a rule about *reads*, and it survives the mock: a
 * report's URL carries an HMAC over the object key and an expiry, and
 * `GET /files/:key` refuses anything else. A report is a clinical document
 * (`DB-P7`), so a guessable path would be the whole access-control story
 * undone by a URL somebody forwarded.
 *
 * The object key is derived from the report's own id and never from the
 * uploaded file name. A file called `../../etc/passwd` is a file called
 * nothing.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { logger } from '../config/logger.js';
import { env } from '../env.js';

/** What a store is asked to keep. */
export interface StoredFile {
  /** The object key, e.g. `reports/<reportId>.pdf`. Built by the caller. */
  readonly key: string;
  readonly contentType: string;
  readonly bytes: Buffer;
}

/** What it reports back. `url` is signed and expires. */
export interface StoredFileRef {
  readonly key: string;
  readonly url: string;
  readonly bytes: number;
}

export interface StorageAdapter {
  readonly name: string;
  put(file: StoredFile): Promise<StoredFileRef>;
  /** A fresh signed URL for an object already stored. */
  signedUrl(key: string): Promise<string>;
  /** The bytes, for the route that serves a mock URL. Null when unknown. */
  get(key: string): Promise<{ contentType: string; bytes: Buffer } | null>;
}

/**
 * The signature on a URL.
 *
 * Keyed on `JWT_ACCESS_SECRET` rather than a secret of its own: it is the same
 * trust root, this version has no key rotation to coordinate, and adding a
 * fourth secret to `.env.example` for one route would be ceremony. A real
 * bucket signs with its own key and this function is unused there.
 */
function sign(key: string, expiresAt: number): string {
  return createHmac('sha256', env.JWT_ACCESS_SECRET)
    .update(`${key}:${String(expiresAt)}`)
    .digest('base64url');
}

/** Whether a presented signature is this server's, for this key, still valid. */
export function verifyFileSignature(
  key: string,
  expiresAt: number,
  signature: string,
): { ok: true } | { ok: false; reason: 'expired' | 'bad_signature' } {
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  const expected = Buffer.from(sign(key, expiresAt));
  const presented = Buffer.from(signature);

  // Length first: timingSafeEqual throws on a mismatch, and the length of a
  // signature is not a secret.
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
    return { ok: false, reason: 'bad_signature' };
  }

  return { ok: true };
}

function mockUrlFor(key: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + env.STORAGE_URL_TTL_SECONDS;
  const params = new URLSearchParams({
    expires: String(expiresAt),
    sig: sign(key, expiresAt),
  });
  return `/files/${encodeURIComponent(key)}?${params.toString()}`;
}

/**
 * Keeps files in this process.
 *
 * A `Map`, not a temporary directory: the demo database is reset routinely
 * (`pnpm db:reset`) and a directory of orphaned PDFs would outlive the rows
 * that point at them. Losing both together is the tidier failure, and it is
 * the one the production guard exists to prevent from mattering.
 */
export class MockStorageAdapter implements StorageAdapter {
  readonly name = 'mock';

  private readonly files = new Map<string, { contentType: string; bytes: Buffer }>();

  async put(file: StoredFile): Promise<StoredFileRef> {
    this.files.set(file.key, { contentType: file.contentType, bytes: file.bytes });

    // The key names a report, not a patient, so it is safe to log (CLAUDE.md §7).
    logger.info({ key: file.key, bytes: file.bytes.length }, 'file stored');

    return await Promise.resolve({
      key: file.key,
      url: mockUrlFor(file.key),
      bytes: file.bytes.length,
    });
  }

  async signedUrl(key: string): Promise<string> {
    return await Promise.resolve(mockUrlFor(key));
  }

  async get(key: string): Promise<{ contentType: string; bytes: Buffer } | null> {
    return await Promise.resolve(this.files.get(key) ?? null);
  }

  /** How many objects are held. For tests. */
  size(): number {
    return this.files.size;
  }
}

/**
 * Refuses everything, with the reason.
 *
 * `STORAGE_PROVIDER=supabase` names a bucket that needs three keys this
 * repository does not hold. Rather than construct a client that throws on
 * first use, this fails the upload with a named reason the route turns into
 * an error the lab can read — the same honesty `UnconfiguredSmsAdapter` has.
 */
export class UnconfiguredStorageAdapter implements StorageAdapter {
  readonly name = 'unconfigured';

  async put(): Promise<StoredFileRef> {
    return await Promise.reject(new Error('no_storage_provider_configured'));
  }

  async signedUrl(): Promise<string> {
    return await Promise.reject(new Error('no_storage_provider_configured'));
  }

  async get(): Promise<null> {
    return await Promise.resolve(null);
  }
}

let current: StorageAdapter | null = null;

/** The store this process writes to. */
export function storage(): StorageAdapter {
  current ??=
    env.STORAGE_PROVIDER === 'mock' ? new MockStorageAdapter() : new UnconfiguredStorageAdapter();
  return current;
}

/** Replaces it. Called by tests; nothing in production calls this. */
export function setStorageAdapter(adapter: StorageAdapter): void {
  current = adapter;
}

/** Restores the environment's choice. */
export function resetStorageAdapter(): StorageAdapter {
  current = null;
  return storage();
}
