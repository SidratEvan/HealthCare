/**
 * Request shapes for a facility's own setup (`S-B-11`, pilot step 22,
 * `FR-SUP-01`, `FR-ADM-11`, BACKEND.md §7.7 `/hospital/*`).
 *
 * Shared by the API, which validates with them, and the console, which builds
 * the settings forms from them. Strict objects: a stray field is a 400.
 *
 * Money is integer poisha (`DB-P5`); the console converts taka as typed.
 * Times are Asia/Dhaka wall-clock `HH:MM`, because a schedule is what the
 * chamber door says, not an instant.
 */

import { z } from 'zod';

import { BED_KINDS, CAPABILITY_KINDS, FACILITY_KINDS } from '../types/enums.js';

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(120);
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

/** `hospitals.phone` accepts a landline as well as a mobile (0004). */
const facilityPhone = z
  .string()
  .trim()
  .regex(/^\+880[0-9]{8,11}$/, 'must start +880, e.g. +8802912345678');

/** Integer poisha, up to ten lakh taka — a sanity bound, not a price. */
const poisha = z.number().int().min(0).max(100_000_000);

/** `HH:MM`, 24-hour. */
export const wallClock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');

/**
 * The roles a hospital administrator may give. `platform_admin` and
 * `gov_viewer` belong to nobody's facility (`FR-ROLE-01`), so a facility
 * cannot hand them out.
 */
export const FACILITY_ROLES = [
  'receptionist',
  'doctor',
  'ward',
  'emergency',
  'lab',
  'pharmacy',
  'hospital_admin',
] as const;
export type FacilityRole = (typeof FACILITY_ROLES)[number];

const roles = z
  .array(z.enum(FACILITY_ROLES))
  .min(1)
  .max(FACILITY_ROLES.length)
  .refine((list) => new Set(list).size === list.length, 'each role once');

export const settingsIdParams = z.object({ id: uuid });

// --- profile and queue rules --------------------------------------------------

export const profileBody = z
  .strictObject({
    nameBn: name.optional(),
    nameEn: name.optional(),
    /**
     * What the hospital was registered as (plan D2). Its own to correct
     * while the workspace is setting up, and refused afterwards
     * (`identityEditable`): these are what the platform reviews.
     */
    division: z.string().trim().min(2).max(40).optional(),
    district: z.string().trim().min(2).max(60).optional(),
    registrationNo: optionalText(60),
    thana: optionalText(80),
    addressBn: optionalText(300),
    addressEn: optionalText(300),
    /** What the hospital says of itself to patients (`FR-BRD-06`); null clears it. */
    descriptionBn: optionalText(400),
    descriptionEn: optionalText(400),
    phone: facilityPhone.nullable().optional(),
    emergencyPhone: facilityPhone.nullable().optional(),
    /** Both or neither (`hospitals_coords_paired`); null clears them. */
    coordinates: z
      .strictObject({
        lat: z.number().min(20).max(27),
        lng: z.number().min(87.5).max(93),
      })
      .nullable()
      .optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'change at least one field');

/** `FR-QUE-20`, `FR-QUE-21`, `FR-OFF-04`: the defaults live in the schema. */
export const rulesBody = z
  .strictObject({
    noShowGracePatients: z.number().int().min(0).max(20).optional(),
    noShowGraceMinutes: z.number().int().min(0).max(120).optional(),
    lateReinsertAfter: z.number().int().min(1).max(20).optional(),
    staleThresholdMinutes: z.number().int().min(1).max(1_440).optional(),
    /** `FR-NOT-06`: SMS a month; null means no cap. */
    smsBudgetMonthly: z.number().int().min(0).max(10_000_000).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'change at least one field');

// --- departments --------------------------------------------------------------

export const departmentBody = z.strictObject({
  nameBn: name,
  nameEn: name,
  /** `CARD`, `MED`: what discovery filters on (`FR-PAT-11`). */
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9-]{1,11}$/)
    .transform((value) => value.toUpperCase()),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export const departmentPatchBody = z
  .strictObject({
    nameBn: name.optional(),
    nameEn: name.optional(),
    sortOrder: z.number().int().min(0).max(999).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'change at least one field');

// --- doctors ------------------------------------------------------------------

/** A BMDC registration as printed: `A-12345`, `12345`. Stored upper-case. */
export const bmdcNumber = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{0,6}-?\d{1,7}$/, 'a BMDC registration number, e.g. A-12345')
  .transform((value) => value.toUpperCase());

const specialty = z
  .string()
  .trim()
  .regex(/^[a-z][a-z_-]{1,40}$/);

export const doctorBody = z.strictObject({
  nameBn: name,
  nameEn: name,
  bmdcNumber,
  degrees: z.string().trim().min(1).max(300).nullable().optional(),
  specialties: z.array(specialty).max(5).optional(),
  defaultConsultMinutes: z.number().int().min(1).max(180).optional(),
  departmentId: uuid,
  feePoisha: poisha,
  room: z.string().trim().min(1).max(40).nullable().optional(),
});

export const doctorPatchBody = z
  .strictObject({
    /** Identity: only while the BMDC number is unverified (`FR-SUP-02`). */
    nameBn: name.optional(),
    nameEn: name.optional(),
    degrees: z.string().trim().min(1).max(300).nullable().optional(),
    defaultConsultMinutes: z.number().int().min(1).max(180).optional(),
    /** This facility's terms: always editable. */
    feePoisha: poisha.optional(),
    room: z.string().trim().min(1).max(40).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'change at least one field');

// --- weekly schedules ---------------------------------------------------------

export const templateBody = z
  .strictObject({
    doctorHospitalId: uuid,
    /** ISO weekday, 1 = Monday … 7 = Sunday (`session_templates.weekday`). */
    weekday: z.number().int().min(1).max(7),
    startTime: wallClock,
    endTime: wallClock,
    capacity: z.number().int().min(1).max(500).nullable().optional(),
  })
  .refine((body) => body.endTime > body.startTime, {
    message: 'the chamber must end after it starts',
    path: ['endTime'],
  });

// --- wards and beds -----------------------------------------------------------

export const wardBody = z.strictObject({
  nameBn: name,
  nameEn: name,
  floor: z.number().int().min(0).max(60),
  kind: z.enum(BED_KINDS),
});

/** A ward's names and floor; what kind of ward it is does not change (plan D2). */
export const wardPatchBody = z
  .strictObject({
    nameBn: name.optional(),
    nameEn: name.optional(),
    floor: z.number().int().min(0).max(60).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'change at least one field');

const bedLabel = z.string().trim().min(1).max(20);

/** Several beds at once: a ward is set up with "301" to "320", not one at a time. */
export const bedsBody = z.strictObject({
  wardId: uuid,
  labels: z
    .array(bedLabel)
    .min(1)
    .max(200)
    .refine(
      (list) => new Set(list.map((label) => label.toLowerCase())).size === list.length,
      'each label once',
    ),
  kind: z.enum(BED_KINDS),
  nightlyPoisha: poisha,
});

export const bedPatchBody = z
  .strictObject({
    label: bedLabel.optional(),
    nightlyPoisha: poisha.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'change at least one field');

// --- staff --------------------------------------------------------------------

const staffCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,15}$/)
  .transform((value) => value.toUpperCase());

export const staffBody = z.strictObject({
  fullName: name,
  email: z.string().trim().min(3).max(254).includes('@'),
  staffCode: staffCode.nullable().optional(),
  roles,
});

export const staffPatchBody = z
  .strictObject({
    fullName: name.optional(),
    staffCode: staffCode.nullable().optional(),
    isActive: z.boolean().optional(),
    roles: roles.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'change at least one field');

// --- what the facility offers in an emergency (FR-EMG-05) ------------------

/**
 * `PUT /hospital/capabilities` — the kinds this facility offers. Whether one
 * is available right now is the ER's to say, not the administrator's.
 */
export const declaredCapabilitiesBody = z.strictObject({
  kinds: z
    .array(z.enum(CAPABILITY_KINDS))
    .max(CAPABILITY_KINDS.length)
    .refine((list) => new Set(list).size === list.length, 'each kind once'),
});

/** `POST /hospital/request-review` and `POST /hospital/staff/:id/reset-password` carry nothing. */
export const emptyBody = z.strictObject({});

// --- onboarding, the platform's side (S-B-12, FR-ONB-*) ----------------------

/**
 * `POST /platform/hospitals` (`FR-ONB-01`): a workspace and its first
 * administrator. Everything else about the hospital is set up by that
 * administrator on `S-B-11`; this asks only for what identifies it.
 */
export const workspaceBody = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]{1,15}$/)
    .transform((value) => value.toUpperCase()),
  nameBn: name,
  nameEn: name,
  kind: z.enum(FACILITY_KINDS),
  division: z.string().trim().min(2).max(40),
  district: z.string().trim().min(2).max(60),
  /** The licence or registration number, as the hospital gives it. */
  registrationNo: z.string().trim().min(2).max(60).optional(),
  adminName: name,
  adminEmail: z.string().trim().toLowerCase().email().max(254),
});
export type WorkspaceBody = z.infer<typeof workspaceBody>;

/**
 * The body of every act on a workspace. `note` is the reason, required by
 * the service for the acts a hospital has to act on (sending back,
 * suspending, closing) and ignored for the others.
 */
export const lifecycleNoteBody = z.strictObject({
  note: z.string().trim().min(3).max(500).optional(),
});

export const platformDoctorParams = z.object({ id: uuid, doctorId: uuid });

export type ProfileBody = z.infer<typeof profileBody>;
export type RulesBody = z.infer<typeof rulesBody>;
export type DepartmentBody = z.infer<typeof departmentBody>;
export type DepartmentPatchBody = z.infer<typeof departmentPatchBody>;
export type DoctorBody = z.infer<typeof doctorBody>;
export type DoctorPatchBody = z.infer<typeof doctorPatchBody>;
export type TemplateBody = z.infer<typeof templateBody>;
export type WardBody = z.infer<typeof wardBody>;
export type WardPatchBody = z.infer<typeof wardPatchBody>;
export type BedsBody = z.infer<typeof bedsBody>;
export type BedPatchBody = z.infer<typeof bedPatchBody>;
export type StaffBody = z.infer<typeof staffBody>;
export type StaffPatchBody = z.infer<typeof staffPatchBody>;
export type DeclaredCapabilitiesBody = z.infer<typeof declaredCapabilitiesBody>;

/**
 * The out-of-service reason on a bed added from settings. A reason is
 * otherwise what the ward typed; this one is a code the board translates
 * (`bedUnconfirmed`), so a new bed says "not yet confirmed" in the reader's
 * language until the ward brings it into service.
 */
export const BED_UNCONFIRMED_REASON = 'setup:unconfirmed';
