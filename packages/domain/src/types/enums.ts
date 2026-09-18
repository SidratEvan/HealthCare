/**
 * The enums from DATABASE.md §1, as the single definition in the codebase.
 *
 * Each one is a frozen tuple of labels plus a union type derived from it, so
 * the labels are available at runtime (for validation and for `db:verify`) and
 * as a type (for the reducer's exhaustive switches). `db/scripts/lib/verify.ts`
 * imports these and asserts the database agrees, which means a label added to
 * one side and forgotten on the other fails CI instead of reaching a console
 * as an unhandled case.
 *
 * Order matters and is the document's order: PostgreSQL enum sort order is
 * declaration order, and `ORDER BY status` in a console query depends on it.
 *
 * Adding a label: add it here, add `ALTER TYPE ... ADD VALUE` in a new
 * migration, and handle it wherever the compiler now complains. Never reorder,
 * never rename.
 */

export const USER_KINDS = ['patient', 'guest', 'staff', 'platform'] as const;
export type UserKind = (typeof USER_KINDS)[number];

export const SEXES = ['male', 'female', 'other'] as const;
export type Sex = (typeof SEXES)[number];

export const STAFF_ROLES = [
  'receptionist',
  'doctor',
  'ward',
  'emergency',
  'lab',
  'pharmacy',
  'hospital_admin',
  'platform_admin',
  'gov_viewer',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const FACILITY_KINDS = ['hospital', 'clinic', 'diagnostic', 'government'] as const;
export type FacilityKind = (typeof FACILITY_KINDS)[number];

export const SESSION_STATUSES = ['scheduled', 'running', 'paused', 'ended', 'cancelled'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const BOOKING_STATUSES = [
  'booked',
  'waiting',
  'in_chamber',
  'done',
  'late',
  'no_show',
  'cancelled',
  'rescheduled',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_SOURCES = ['app', 'guest_link', 'counter', 'phone', 'walkin'] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

/**
 * The 18 facts that can be true about a session (FR-QUE-03).
 *
 * The queue is derived from these and nothing else (DB-P1). Every switch over
 * this union is checked for exhaustiveness by lint, so a new event type cannot
 * be added without the reducer being forced to decide what it means.
 */
export const QUEUE_EVENT_TYPES = [
  'SESSION_OPENED',
  'DOCTOR_ARRIVED',
  'DELAY_DECLARED',
  'SESSION_PAUSED',
  'SESSION_RESUMED',
  'PATIENT_CALLED',
  'PATIENT_DONE',
  'PATIENT_LATE',
  'PATIENT_NO_SHOW',
  'PATIENT_REINSERTED',
  'WALKIN_ADDED',
  'BOOKING_CANCELLED',
  'SLOT_OFFERED',
  'SLOT_ACCEPTED',
  'SLOT_EXPIRED',
  'PRIORITY_REORDERED',
  'SESSION_ENDED',
  'ACTION_UNDONE',
] as const;
export type QueueEventType = (typeof QUEUE_EVENT_TYPES)[number];

export const BED_KINDS = [
  'general',
  'cabin',
  'hdu',
  'icu',
  'ccu',
  'nicu',
  'isolation',
  'burn',
] as const;
export type BedKind = (typeof BED_KINDS)[number];

export const BED_STATES = ['free', 'occupied', 'cleaning', 'reserved', 'out_of_service'] as const;
export type BedState = (typeof BED_STATES)[number];

export const TRIAGE_COLORS = ['red', 'yellow', 'green'] as const;
export type TriageColor = (typeof TRIAGE_COLORS)[number];

export const EMERGENCY_STATES = [
  'inbound',
  'acknowledged',
  'arrived',
  'in_treatment',
  'admitted',
  'discharged',
  'referred',
  'cancelled',
] as const;
export type EmergencyState = (typeof EMERGENCY_STATES)[number];

export const REFERRAL_STATES = [
  'sent',
  'seen',
  'accepted',
  'declined',
  'arrived',
  'cancelled',
] as const;
export type ReferralState = (typeof REFERRAL_STATES)[number];

export const TEST_STATES = [
  'ordered',
  'sample_collected',
  'processing',
  'report_ready',
  'delivered',
  'cancelled',
] as const;
export type TestState = (typeof TEST_STATES)[number];

export const PAYMENT_METHODS = ['bkash', 'nagad', 'card', 'cash', 'at_hospital'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATES = [
  'pending',
  'paid',
  'failed',
  'refunded',
  'partially_refunded',
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const NOTIF_CHANNELS = ['push', 'sms', 'ivr', 'in_app'] as const;
export type NotifChannel = (typeof NOTIF_CHANNELS)[number];

export const NOTIF_STATES = ['queued', 'sent', 'delivered', 'failed', 'skipped'] as const;
export type NotifState = (typeof NOTIF_STATES)[number];

export const CAPABILITY_KINDS = [
  'burn_unit',
  'cardiac',
  'cath_lab',
  'stroke',
  'dialysis',
  'nicu',
  'trauma_ot',
  'blood_bank',
  'ambulance',
  'isolation',
] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

export const CONSENT_SCOPES = ['visit', 'hospital', 'doctor', 'full'] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

/** Locales. bn is the product, en is the toggle (FR-LOC-01, I18N-01). */
export const LOCALES = ['bn', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Every PostgreSQL enum in the schema, keyed by its type name.
 *
 * `db:verify` walks this to compare the database against the document. Only
 * types that exist in the database belong here — `LOCALES` is a `text` column
 * with a CHECK, not an enum, and is deliberately absent.
 */
export const DATABASE_ENUMS = {
  user_kind: USER_KINDS,
  sex: SEXES,
  staff_role: STAFF_ROLES,
  facility_kind: FACILITY_KINDS,
  session_status: SESSION_STATUSES,
  booking_status: BOOKING_STATUSES,
  booking_source: BOOKING_SOURCES,
  queue_event_type: QUEUE_EVENT_TYPES,
  bed_kind: BED_KINDS,
  bed_state: BED_STATES,
  triage_color: TRIAGE_COLORS,
  emergency_state: EMERGENCY_STATES,
  referral_state: REFERRAL_STATES,
  test_state: TEST_STATES,
  payment_method: PAYMENT_METHODS,
  payment_state: PAYMENT_STATES,
  notif_channel: NOTIF_CHANNELS,
  notif_state: NOTIF_STATES,
  capability_kind: CAPABILITY_KINDS,
  consent_scope: CONSENT_SCOPES,
} as const satisfies Record<string, readonly string[]>;

/** Booking statuses that still occupy a place in the queue. */
export const ACTIVE_BOOKING_STATUSES = ['booked', 'waiting', 'in_chamber', 'late'] as const;

/** Booking statuses that have left the queue, for better or worse. */
export const SETTLED_BOOKING_STATUSES = ['done', 'no_show', 'cancelled', 'rescheduled'] as const;

export function isActiveBookingStatus(status: BookingStatus): boolean {
  return (ACTIVE_BOOKING_STATUSES as readonly BookingStatus[]).includes(status);
}
