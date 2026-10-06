/**
 * Request shapes for importing a hospital's own data (`S-B-14`, pilot step 24,
 * BACKEND.md §7.7 `/hospital/imports`, `FR-IMP-05`…`09`).
 *
 * The file travels as UTF-8 text inside JSON — no multipart parser, no new
 * dependency — at most five megabytes of it, which is a few tens of
 * thousands of patient rows.
 */

import { z } from 'zod';

import { STRUCTURE_TYPES } from '../imports/mapping.js';
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

// --- a hospital's own export, mapped onto the template (FR-IMP-13–20) -------

const structureType = z.enum(STRUCTURE_TYPES);

/**
 * `POST /hospital/imports/analyse`: a file to read and propose a mapping for.
 * `rowType` says which kind of row a structure file holds, when the
 * administrator has chosen; without it the server remembers or guesses.
 */
export const importAnalyseBody = z.strictObject({
  set: z.enum(IMPORT_SETS),
  csv: z.string().min(1).max(MAX_IMPORT_BYTES),
  rowType: structureType.optional(),
});
export type ImportAnalyseBody = z.infer<typeof importAnalyseBody>;

/**
 * Which file column feeds each template field (`FR-IMP-18`).
 *
 * The shape only. Whether the fields are the template's and the columns the
 * file's is `mappingProblems`' to say, against the file that came with it.
 */
export const columnMapping = z.strictObject({
  rowType: structureType.nullable(),
  fields: z.record(
    z.string().regex(/^[a-z][a-z_]{1,30}$/),
    z.number().int().min(0).max(500).nullable(),
  ),
});

/**
 * `POST /hospital/imports/mapped`: the file again, with the mapping a person
 * confirmed. `suggestedByModel` names the fields whose column a model
 * suggested, for the audit; it changes nothing about what is checked.
 */
export const importMappedBody = z.strictObject({
  set: z.enum(IMPORT_SETS),
  fileName: z.string().trim().min(1).max(200),
  csv: z.string().min(1).max(MAX_IMPORT_BYTES),
  mapping: columnMapping,
  suggestedByModel: z
    .array(z.string().regex(/^[a-z][a-z_]{1,30}$/))
    .max(40)
    .optional(),
});
export type ImportMappedBody = z.infer<typeof importMappedBody>;
