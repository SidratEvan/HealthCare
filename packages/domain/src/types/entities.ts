/**
 * The domain's view of the rows in DATABASE.md §2.
 *
 * Camel-cased, branded, and carrying only what callers outside the repository
 * layer have any business seeing — a repository maps a row to one of these and
 * nothing above it ever sees a snake_cased column name.
 *
 * Scoped to the tables migrations 0001-0006 create. Beds, emergency cases,
 * referrals, payments and clinical records arrive with the steps that build
 * them, so that a type here always corresponds to a table that exists.
 */

import type {
  BookingSource,
  BookingStatus,
  FacilityKind,
  Locale,
  Sex,
  SessionStatus,
  StaffRole,
} from './enums.js';
import type {
  BookingId,
  DepartmentId,
  DhakaDate,
  DoctorHospitalId,
  DoctorId,
  GuestId,
  HospitalId,
  PatientId,
  Poisha,
  Serial,
  SessionId,
  SessionTemplateId,
  StaffUserId,
  Timestamp,
  UserId,
} from './ids.js';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export interface User {
  readonly id: UserId;
  /** Normalised `+8801…` (DB-P6). */
  readonly phone: string;
  readonly locale: Locale;
  readonly phoneVerifiedAt: Timestamp | null;
}

/** A person who booked without registering, claimable later (FR-GST-09). */
export interface GuestIdentity {
  readonly id: GuestId;
  readonly phone: string;
  readonly displayName: string | null;
  readonly phoneVerifiedAt: Timestamp | null;
  readonly claimedByUserId: UserId | null;
  readonly bookingCount: number;
  /** Rolling-window counter behind the prepayment rule (FR-GST-14). */
  readonly noShowCount: number;
}

/**
 * A clinical subject. Owned by a user or by a guest identity, never both —
 * which is what keeps a mother's records under her own profile when her son
 * does the booking (FR-PAT-03).
 */
export interface Patient {
  readonly id: PatientId;
  readonly ownerUserId: UserId | null;
  readonly ownerGuestId: GuestId | null;
  readonly fullName: string;
  readonly dateOfBirth: DhakaDate | null;
  readonly ageYears: number | null;
  readonly sex: Sex;
  readonly bloodGroup: string | null;
  readonly phone: string | null;
  readonly relationship: 'self' | 'mother' | 'father' | 'child' | 'spouse' | 'other';
  readonly isPrimary: boolean;
}

export interface StaffUser {
  readonly id: StaffUserId;
  readonly hospitalId: HospitalId;
  readonly email: string;
  readonly staffCode: string | null;
  readonly fullName: string;
  readonly isActive: boolean;
  readonly roles: readonly StaffRole[];
}

// ---------------------------------------------------------------------------
// Facilities
// ---------------------------------------------------------------------------

export interface Hospital {
  readonly id: HospitalId;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly kind: FacilityKind;
  readonly division: string;
  readonly district: string;
  readonly thana: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly phone: string | null;
  readonly emergencyPhone: string | null;
  readonly isLive: boolean;
}

/**
 * Per-facility policy. Every default is the value the requirements name, so a
 * hospital that never opens the settings screen still behaves as specified.
 */
export interface HospitalSettings {
  readonly hospitalId: HospitalId;
  /** FR-QUE-20, first half of "2 patients or 15 minutes, whichever is longer". */
  readonly noShowGracePatients: number;
  /** FR-QUE-20, second half. */
  readonly noShowGraceMinutes: number;
  /** k in FR-QUE-21: a late patient returns after this many patients. */
  readonly lateReinsertAfter: number;
  /** Beyond this a live figure is labelled stale and de-ranked (FR-OFF-04). */
  readonly staleThresholdMinutes: number;
  readonly smsBudgetMonthly: number | null;
  readonly prepayRequired: boolean;
  readonly numeralStyle: 'latin' | 'bengali';
  readonly densityDefault: 'comfortable' | 'compact';
}

export interface Department {
  readonly id: DepartmentId;
  readonly hospitalId: HospitalId;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly code: string;
  readonly sortOrder: number;
}

export interface Doctor {
  readonly id: DoctorId;
  readonly fullNameBn: string;
  readonly fullNameEn: string;
  readonly bmdcNumber: string;
  /** Null means unverified, which means not publishable (FR-SUP-02). */
  readonly bmdcVerifiedAt: Timestamp | null;
  readonly degrees: string | null;
  readonly specialties: readonly string[];
  readonly photoUrl: string | null;
  /** Seeds the rolling rate for a doctor with no history (FR-QUE-10). */
  readonly defaultConsultMinutes: number;
  readonly userId: UserId | null;
}

/** A doctor sitting at one facility, in one department, for a fee. */
export interface DoctorHospital {
  readonly id: DoctorHospitalId;
  readonly doctorId: DoctorId;
  readonly hospitalId: HospitalId;
  readonly departmentId: DepartmentId;
  readonly feePoisha: Poisha;
  readonly room: string | null;
  readonly isActive: boolean;
}

// ---------------------------------------------------------------------------
// Sessions and bookings
// ---------------------------------------------------------------------------

/** A recurring chamber schedule. `weekday` is ISO: 1 = Monday, 7 = Sunday. */
export interface SessionTemplate {
  readonly id: SessionTemplateId;
  readonly doctorHospitalId: DoctorHospitalId;
  readonly weekday: number;
  /** Dhaka wall-clock `HH:MM`, the only clock a hospital thinks in. */
  readonly startTime: string;
  readonly endTime: string;
  readonly capacity: number | null;
  readonly activeFrom: DhakaDate;
  readonly activeTo: DhakaDate | null;
}

/**
 * One doctor, one chamber, one date (FR-QUE-01).
 *
 * `actualStart`, `delayMinutes`, `avgConsultSeconds` and `lastEventSeq` are
 * projections of the event log, never the place a decision is made (DB-P1).
 */
export interface Session {
  readonly id: SessionId;
  readonly hospitalId: HospitalId;
  readonly doctorId: DoctorId;
  readonly departmentId: DepartmentId;
  readonly room: string | null;
  readonly sessionDate: DhakaDate;
  readonly plannedStart: Timestamp;
  readonly plannedEnd: Timestamp;
  readonly actualStart: Timestamp | null;
  readonly actualEnd: Timestamp | null;
  readonly status: SessionStatus;
  /** Serials offered; null means unlimited. */
  readonly capacity: number | null;
  readonly feePoisha: Poisha;
  readonly delayMinutes: number;
  readonly avgConsultSeconds: number | null;
  readonly lastEventSeq: number;
}

export interface Booking {
  readonly id: BookingId;
  readonly sessionId: SessionId;
  readonly patientId: PatientId;
  readonly bookedByUserId: UserId | null;
  readonly bookedByGuestId: GuestId | null;
  readonly serialNumber: Serial;
  readonly status: BookingStatus;
  readonly source: BookingSource;
  /** Pre-visit answers, so the doctor's screen is populated (FR-DOC-03). */
  readonly intake: Readonly<Record<string, unknown>>;
  readonly reasonText: string | null;
  readonly feePoisha: Poisha;
  readonly calledAt: Timestamp | null;
  readonly doneAt: Timestamp | null;
  readonly arrivedAt: Timestamp | null;
  readonly consultSeconds: number | null;
  readonly cancelledReason: string | null;
  readonly createdAt: Timestamp;
}
