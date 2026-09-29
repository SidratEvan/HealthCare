/**
 * Request shapes for importing a hospital's own data (`S-B-14`, pilot step 24,
 * BACKEND.md §7.7 `/hospital/imports`, `FR-IMP-05`…`09`).
 *
 * The file travels as UTF-8 text inside JSON — no multipart parser, no new
 * dependency — at most five megabytes of it, which is a few tens of
 * thousands of patient rows.
 */

import { z } from 'zod';

import { IMPORT_SETS } from '../imports/sets.js';

/** Five megabytes of CSV text. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export const importSetParams = z.object({ set: z.enum(IMPORT_SETS) });
export const importParams = z.object({ id: z.string().uuid() });

export const importUploadBody = z.strictObject({
  set: z.enum(IMPORT_SETS),
  fileName: z.string().trim().min(1).max(200),
  csv: z.string().min(1).max(MAX_IMPORT_BYTES),
});

export type ImportUploadBody = z.infer<typeof importUploadBody>;
