/**
 * Counter registration (`S-B-03`, pilot step 23, `FR-REC-20`, `FR-GST-13`,
 * BACKEND.md §7.3 `/registration/*`).
 *
 * A patient at the counter is registered the way a guest books: a phone
 * number and a name, never an account (`FR-GST-13`). The phone is taken as
 * typed — `017…`, `+88017…`, with spaces — and normalised by the server
 * (`DB-P6`), because a receptionist types it the way the patient says it.
 */

import { z } from 'zod';

import { SEXES } from '../types/enums.js';

/** A phone as typed at the counter; the server normalises it or refuses it. */
const typedPhone = z.string().trim().min(10).max(20);

/** `GET /registration/patients?phone=` — duplicate detection by phone (`FR-REC-20`). */
export const registrationLookupQuery = z.object({ phone: typedPhone });

/** `POST /registration/patients` — phone, name, age, sex; nothing else is needed. */
export const registerPatientBody = z.strictObject({
  phone: typedPhone,
  fullName: z.string().trim().min(1).max(120),
  ageYears: z.number().int().min(0).max(130),
  sex: z.enum(SEXES),
});

export type RegistrationLookupQuery = z.infer<typeof registrationLookupQuery>;
export type RegisterPatientBody = z.infer<typeof registerPatientBody>;
