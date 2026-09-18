/**
 * The database as Kysely sees it — one interface per table in migrations
 * 0001-0006, with snake_cased columns exactly as they exist.
 *
 * Deliberately separate from `@platform/domain`'s entities. Those are the
 * camel-cased shapes the rest of the application works in; these are rows,
 * with `Generated<>` on anything the database fills in and `ColumnType<>`
 * where what you insert differs from what you read back. A repository is the
 * only place both vocabularies appear, and mapping between them is its job.
 *
 * Hand-written rather than generated, because a generator would need to run
 * against a live database in CI and would lose every comment explaining why a
 * column is nullable. It grows one migration at a time, alongside the
 * migration — a table here that does not exist in `db/migrations` is a bug in
 * one of the two.
 */

import type {
  BookingSource,
  BookingStatus,
  CapabilityKind,
  FacilityKind,
  QueueEventType,
  SessionStatus,
  Sex,
  StaffRole,
  UserKind,
} from '@platform/domain';

import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

/** A timestamptz: written as a Date or an ISO string, read back as a Date. */
type Timestamp = ColumnType<Date, Date | string, Date | string>;

/** A date column, read back as a string so no time zone is implied. */
type DateString = ColumnType<string, string, string>;

/** jsonb. Written as an object, read back as one. */
type Json = ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;

// ---------------------------------------------------------------------------
// 0003 identity
// ---------------------------------------------------------------------------

export interface UsersTable {
  id: Generated<string>;
  phone: string;
  kind: Generated<UserKind>;
  locale: Generated<string>;
  phone_verified_at: Timestamp | null;
  last_login_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface GuestIdentitiesTable {
  id: Generated<string>;
  phone: string;
  display_name: string | null;
  phone_verified_at: Timestamp | null;
  claimed_by_user_id: string | null;
  claimed_at: Timestamp | null;
  booking_count: Generated<number>;
  no_show_count: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface PatientsTable {
  id: Generated<string>;
  /** Exactly one owner column is set (patients_one_owner). */
  owner_user_id: string | null;
  owner_guest_id: string | null;
  full_name: string;
  date_of_birth: DateString | null;
  age_years: number | null;
  sex: Sex;
  blood_group: string | null;
  phone: string | null;
  /** Encrypted by the application before it reaches this column. */
  national_id: string | null;
  relationship: Generated<string>;
  is_primary: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  created_by: string | null;
  deleted_at: Timestamp | null;
}

export interface StaffUsersTable {
  id: Generated<string>;
  hospital_id: string;
  email: string;
  staff_code: string | null;
  full_name: string;
  /** argon2id. Never selected into anything that leaves the repository. */
  password_hash: string;
  totp_secret: string | null;
  is_active: Generated<boolean>;
  last_login_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  created_by: string | null;
  deleted_at: Timestamp | null;
}

export interface StaffRolesTable {
  id: Generated<string>;
  staff_user_id: string;
  hospital_id: string;
  role: StaffRole;
  scope: Generated<Json>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  created_by: string | null;
  deleted_at: Timestamp | null;
}

export interface SessionsAuthTable {
  id: Generated<string>;
  subject_id: string;
  subject_kind: 'user' | 'guest' | 'staff';
  token_hash: string;
  device_fingerprint: string | null;
  ip: string | null;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface GuestLinksTable {
  id: Generated<string>;
  token_hash: string;
  booking_id: string;
  guest_id: string;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  last_used_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

// ---------------------------------------------------------------------------
// 0004 facilities
// ---------------------------------------------------------------------------

export interface HospitalsTable {
  id: Generated<string>;
  name_bn: string;
  name_en: string;
  kind: FacilityKind;
  division: string;
  district: string;
  thana: string | null;
  address_bn: string | null;
  address_en: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  emergency_phone: string | null;
  is_live: Generated<boolean>;
  onboarded_at: Timestamp | null;
  /** Generated from lat/lng by the database; never written. */
  geo: ColumnType<string | null, never, never>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  created_by: string | null;
  deleted_at: Timestamp | null;
}

export interface HospitalSettingsTable {
  hospital_id: string;
  no_show_grace_patients: Generated<number>;
  no_show_grace_minutes: Generated<number>;
  late_reinsert_after: Generated<number>;
  stale_threshold_minutes: Generated<number>;
  refund_policy: Generated<Json>;
  sms_budget_monthly: number | null;
  prepay_required: Generated<boolean>;
  numeral_style: Generated<string>;
  density_default: Generated<string>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  created_by: string | null;
}

export interface DepartmentsTable {
  id: Generated<string>;
  hospital_id: string;
  name_bn: string;
  name_en: string;
  code: string;
  sort_order: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  created_by: string | null;
  deleted_at: Timestamp | null;
}

export interface DoctorsTable {
  id: Generated<string>;
  full_name_bn: string;
  full_name_en: string;
  bmdc_number: string;
  /** Null means unverified, which means not publishable (FR-SUP-02). */
  bmdc_verified_at: Timestamp | null;
  degrees: string | null;
  specialties: Generated<string[]>;
  photo_url: string | null;
  default_consult_minutes: Generated<number>;
  user_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  created_by: string | null;
  deleted_at: Timestamp | null;
}

export interface DoctorHospitalsTable {
  id: Generated<string>;
  doctor_id: string;
  hospital_id: string;
  department_id: string;
  /** Integer poisha (DB-P5). */
  fee_poisha: number;
  room: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  created_by: string | null;
  deleted_at: Timestamp | null;
}

export interface CapabilitiesTable {
  id: Generated<string>;
  hospital_id: string;
  kind: CapabilityKind;
  is_available: Generated<boolean>;
  updated_by: string | null;
  created_at: Generated<Timestamp>;
  /** Drives the freshness stamp a patient sees (FR-PAT-44). */
  updated_at: Generated<Timestamp>;
}

// ---------------------------------------------------------------------------
// 0005 sessions and bookings
// ---------------------------------------------------------------------------

export interface SessionTemplatesTable {
  id: Generated<string>;
  doctor_hospital_id: string;
  /** ISO-8601: 1 = Monday, 7 = Sunday. */
  weekday: number;
  start_time: string;
  end_time: string;
  capacity: number | null;
  active_from: DateString;
  active_to: DateString | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  created_by: string | null;
  deleted_at: Timestamp | null;
}

export interface SessionsTable {
  id: Generated<string>;
  hospital_id: string;
  doctor_id: string;
  department_id: string;
  room: string | null;
  session_date: DateString;
  planned_start: Timestamp;
  planned_end: Timestamp;
  /** Set by DOCTOR_ARRIVED; a running session must have it. */
  actual_start: Timestamp | null;
  actual_end: Timestamp | null;
  status: Generated<SessionStatus>;
  capacity: number | null;
  fee_poisha: number;
  /** Projections of the event log, never a decision (DB-P1). */
  delay_minutes: Generated<number>;
  avg_consult_seconds: number | null;
  last_event_seq: Generated<string>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  created_by: string | null;
  deleted_at: Timestamp | null;
}

export interface BookingsTable {
  id: Generated<string>;
  session_id: string;
  patient_id: string;
  booked_by_user_id: string | null;
  booked_by_guest_id: string | null;
  serial_number: number;
  status: Generated<BookingStatus>;
  source: BookingSource;
  intake: Generated<Json>;
  reason_text: string | null;
  fee_poisha: number;
  payment_id: string | null;
  called_at: Timestamp | null;
  done_at: Timestamp | null;
  arrived_at: Timestamp | null;
  consult_seconds: number | null;
  cancelled_reason: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  created_by: string | null;
  deleted_at: Timestamp | null;
}

// ---------------------------------------------------------------------------
// 0006 the event log
// ---------------------------------------------------------------------------

/**
 * Append-only (DB-P1). The only update the database permits is setting
 * `undone_by_event_id` once; everything else is refused by
 * `trg_queue_events_no_mutate`, so `Updateable<QueueEventsTable>` should never
 * be constructed for any other column.
 */
export interface QueueEventsTable {
  id: Generated<string>;
  /** bigserial, so pg returns it as a string to preserve precision. */
  seq: Generated<string>;
  session_id: string;
  type: QueueEventType;
  booking_id: string | null;
  actor_staff_id: string | null;
  actor_user_id: string | null;
  actor_role: StaffRole | null;
  payload: Generated<Json>;
  client_ts: Timestamp | null;
  server_ts: Generated<Timestamp>;
  client_event_id: string | null;
  undone_by_event_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface QueueStateTable {
  session_id: string;
  now_serving_booking_id: string | null;
  now_serving_serial: number | null;
  waiting_count: Generated<number>;
  late_count: Generated<number>;
  no_show_count: Generated<number>;
  done_count: Generated<number>;
  avg_consult_seconds: number | null;
  projected_end: Timestamp | null;
  rebuilt_from_seq: Generated<string>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface StandbyListTable {
  id: Generated<string>;
  session_id: string;
  patient_id: string;
  contact_phone: string;
  position: number;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  removed_at: Timestamp | null;
}

export interface SlotOffersTable {
  id: Generated<string>;
  session_id: string;
  freed_booking_id: string | null;
  offered_to_patient_id: string;
  offered_at: Generated<Timestamp>;
  expires_at: Timestamp;
  accepted_at: Timestamp | null;
  declined_at: Timestamp | null;
  /** Integer poisha recovered by an acceptance (FR-QUE-31). */
  recovered_value_poisha: number | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

// ---------------------------------------------------------------------------
// The database
// ---------------------------------------------------------------------------

/** Every table a repository may reach. Keys are the real table names. */
export interface Database {
  users: UsersTable;
  guest_identities: GuestIdentitiesTable;
  patients: PatientsTable;
  staff_users: StaffUsersTable;
  staff_roles: StaffRolesTable;
  sessions_auth: SessionsAuthTable;
  guest_links: GuestLinksTable;

  hospitals: HospitalsTable;
  hospital_settings: HospitalSettingsTable;
  departments: DepartmentsTable;
  doctors: DoctorsTable;
  doctor_hospitals: DoctorHospitalsTable;
  capabilities: CapabilitiesTable;

  session_templates: SessionTemplatesTable;
  sessions: SessionsTable;
  bookings: BookingsTable;

  queue_events: QueueEventsTable;
  queue_state: QueueStateTable;
  standby_list: StandbyListTable;
  slot_offers: SlotOffersTable;
}

/** Row shapes, for repository signatures. */
export type Row<T extends keyof Database> = Selectable<Database[T]>;
export type NewRow<T extends keyof Database> = Insertable<Database[T]>;
export type RowUpdate<T extends keyof Database> = Updateable<Database[T]>;
