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
 * The key prefix the seed writes for reports it did not really upload.
 *
 * `seed_04_history` writes delivered reports so the wallet's Reports tab and
 * the turnaround figures have something in them (`FR-DEM-03`, `FR-LAB-04`).
 * It runs in its own process and cannot put bytes into this one's `Map`, so
 * the rows would point at nothing and a patient tapping a report would get a
 * 404 — the demo promising a document it cannot open.
 *
 * So the mock store synthesises one on a miss under this prefix, labelled as
 * demonstration data (`FR-DEM-07`). It is not a real result and does not
 * pretend to be: it says so, in Bangla, on its one page. Nothing outside the
 * mock provider has this behaviour, and a real bucket never sees the prefix.
 */
const DEMO_REPORT_PREFIX = 'reports/demo/';

/**
 * A one-page PDF saying what it is.
 *
 * Written by hand rather than with a PDF library, because adding a dependency
 * to render eight words is not a trade worth making (CLAUDE.md §7) — and this
 * is the whole of it: a page, a font, two lines of text.
 */
export function demoReportPdf(): Buffer {
  const heading = 'DEMONSTRATION DATA - NOT A REAL TEST RESULT';
  const body = 'This platform is running on seeded demo data (FR-DEM-07).';

  // A content stream: begin text, pick a font and a point, draw a line, move
  // down, draw the second, end text.
  const content = [
    'BT',
    '/F1 14 Tf 56 760 Td',
    `(${heading}) Tj`,
    '/F1 10 Tf 0 -28 Td',
    `(${body}) Tj`,
    'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  // Byte offsets, so the xref table is accurate. Every character written here
  // is ASCII, so a string index is a byte index.
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  }

  const startxref = pdf.length;
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\n`;
  pdf += `startxref\n${String(startxref)}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
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
    const held = this.files.get(key);
    if (held !== undefined) return await Promise.resolve(held);

    // A report the seed wrote in another process. See `DEMO_REPORT_PREFIX`.
    if (key.startsWith(DEMO_REPORT_PREFIX)) {
      return await Promise.resolve({ contentType: 'application/pdf', bytes: demoReportPdf() });
    }

    return await Promise.resolve(null);
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
