# Database Document

## National Healthcare Platform — Bangladesh

**Document:** `DATABASE.md` — part of the build set (`PRD.md`, `APP_FLOW.md`, `FRONTEND.md`, **`DATABASE.md`**, `BACKEND.md`)
**Version:** 1.0
**Engine:** PostgreSQL 15+ (Supabase-hosted in v0/v1)
**Purpose:** the complete data layer — every table, column, index, constraint, enum, policy, migration file, and seed file. Nothing here is left to inference.

---

## 0. Principles

1. `DB-P1` **The queue is an event log.** `queue_events` is append-only and is the only writable truth about a session. `queue_state` is a derived cache and may be rebuilt from events at any time (`FR-QUE-02`, `FR-QUE-05`).
2. `DB-P2` **Nothing is hard-deleted** except at an explicit privacy request. Everything uses `deleted_at`.
3. `DB-P3` **Every table carries `created_at`, `updated_at`** (UTC `timestamptz`), and every row that a human created carries `created_by`.
4. `DB-P4` **All timestamps are stored UTC.** Display conversion to Asia/Dhaka happens in the client only.
5. `DB-P5` **Money is `integer` in poisha** (1 BDT = 100 poisha). Never floats.
6. `DB-P6` **Phone numbers are stored normalised** as `+8801XXXXXXXXX` text, unique where identity-bearing.
7. `DB-P7` **Every patient-identifying read by staff writes to `audit_log`** (`FR-SEC-03`).
8. `DB-P8` **Tenant scoping:** every operational table carries `hospital_id`, and row-level security enforces it.
9. `DB-P9` **IDs are UUID v7** (time-sortable) generated server-side, except `serial_number` which is a per-session integer.

---

## 1. Enums

```sql
CREATE TYPE user_kind         AS ENUM ('patient','guest','staff','platform');
CREATE TYPE sex               AS ENUM ('male','female','other');
CREATE TYPE staff_role        AS ENUM ('receptionist','doctor','ward','emergency','lab','pharmacy','hospital_admin','platform_admin','gov_viewer');
CREATE TYPE facility_kind     AS ENUM ('hospital','clinic','diagnostic','government');
CREATE TYPE session_status    AS ENUM ('scheduled','running','paused','ended','cancelled');
CREATE TYPE booking_status    AS ENUM ('booked','waiting','in_chamber','done','late','no_show','cancelled','rescheduled');
CREATE TYPE booking_source    AS ENUM ('app','guest_link','counter','phone','walkin');
CREATE TYPE queue_event_type  AS ENUM (
  'SESSION_OPENED','DOCTOR_ARRIVED','DELAY_DECLARED','SESSION_PAUSED','SESSION_RESUMED',
  'PATIENT_CALLED','PATIENT_DONE','PATIENT_LATE','PATIENT_NO_SHOW','PATIENT_REINSERTED',
  'WALKIN_ADDED','BOOKING_CANCELLED','SLOT_OFFERED','SLOT_ACCEPTED','SLOT_EXPIRED',
  'PRIORITY_REORDERED','SESSION_ENDED','ACTION_UNDONE'
);
CREATE TYPE bed_kind          AS ENUM ('general','cabin','hdu','icu','ccu','nicu','isolation','burn');
CREATE TYPE bed_state         AS ENUM ('free','occupied','cleaning','reserved','out_of_service');
CREATE TYPE triage_color      AS ENUM ('red','yellow','green');
CREATE TYPE emergency_state   AS ENUM ('inbound','acknowledged','arrived','in_treatment','admitted','discharged','referred','cancelled');
CREATE TYPE referral_state    AS ENUM ('sent','seen','accepted','declined','arrived','cancelled');
CREATE TYPE test_state        AS ENUM ('ordered','sample_collected','processing','report_ready','delivered','cancelled');
CREATE TYPE payment_method    AS ENUM ('bkash','nagad','card','cash','at_hospital');
CREATE TYPE payment_state     AS ENUM ('pending','paid','failed','refunded','partially_refunded');
CREATE TYPE notif_channel     AS ENUM ('push','sms','ivr','in_app');
CREATE TYPE notif_state       AS ENUM ('queued','sent','delivered','failed','skipped');
CREATE TYPE capability_kind   AS ENUM ('burn_unit','cardiac','cath_lab','stroke','dialysis','nicu','trauma_ot','blood_bank','ambulance','isolation');
CREATE TYPE consent_scope     AS ENUM ('visit','hospital','doctor','full');
```

---

## 2. Tables

Notation: **PK** primary key · **FK** foreign key · **U** unique · **IX** indexed.

### 2.1 Identity

#### `users`
The account holder. One row per phone number that has registered.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `phone` | text | **U**, normalised (`DB-P6`) |
| `kind` | user_kind | `patient` \| `platform` |
| `locale` | text | `bn` \| `en`, default `bn` |
| `phone_verified_at` | timestamptz | |
| `last_login_at` | timestamptz | |
| `deleted_at` | timestamptz | |

#### `guest_identities` (`FR-GST`)
A person who booked without registering. Keyed by phone, claimable later.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `phone` | text | **U** |
| `display_name` | text | |
| `phone_verified_at` | timestamptz | set by the single OTP (`FR-GST-03`) |
| `claimed_by_user_id` | uuid | **FK** → `users.id`, null until claimed (`FR-GST-09`) |
| `claimed_at` | timestamptz | |
| `booking_count` | int | for rate limiting (`FR-GST-14`) |
| `no_show_count` | int | rolling window counter |

#### `patients`
A clinical subject. Belongs to a `user` **or** a `guest_identity` — never both, never neither.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `owner_user_id` | uuid | **FK** → `users.id`, nullable |
| `owner_guest_id` | uuid | **FK** → `guest_identities.id`, nullable |
| `full_name` | text | |
| `date_of_birth` | date | nullable if `age_years` given |
| `age_years` | int | |
| `sex` | sex | |
| `blood_group` | text | nullable |
| `phone` | text | contact for this patient, may differ from owner |
| `national_id` | text | nullable, encrypted at rest |
| `relationship` | text | `self`,`mother`,`father`,`child`,`spouse`,`other` |
| `is_primary` | boolean | the owner's own profile |

```sql
CONSTRAINT patients_one_owner CHECK (num_nonnulls(owner_user_id, owner_guest_id) = 1)
```
**IX:** `(owner_user_id)`, `(owner_guest_id)`, `(phone)`

#### `staff_users`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `hospital_id` | uuid | **FK** → `hospitals.id` |
| `email` | text | **U** with `hospital_id` |
| `staff_code` | text | printed on the ID card |
| `full_name` | text | |
| `password_hash` | text | argon2id |
| `totp_secret` | text | nullable, encrypted |
| `is_active` | boolean | |
| `last_login_at` | timestamptz | |

#### `staff_roles`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `staff_user_id` | uuid | **FK** |
| `hospital_id` | uuid | **FK** |
| `role` | staff_role | |
| `scope` | jsonb | e.g. `{"wards":["3F"],"counters":["R2"]}` |

**U:** `(staff_user_id, hospital_id, role)`

#### `sessions_auth` (login sessions)
`id`, `subject_id`, `subject_kind` (`user`/`guest`/`staff`), `token_hash`, `device_fingerprint`, `ip`, `expires_at`, `revoked_at`.

#### `guest_links` (`FR-GST-05`)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `token_hash` | text | **U**, 32-byte random, hashed |
| `booking_id` | uuid | **FK**, scope is one booking |
| `guest_id` | uuid | **FK** |
| `expires_at` | timestamptz | session end + grace |
| `revoked_at` | timestamptz | |
| `last_used_at` | timestamptz | |

---

### 2.2 Facilities

#### `hospitals`
`id`, `name_bn`, `name_en`, `kind` (facility_kind), `division`, `district`, `thana`, `address_bn`, `address_en`, `lat`, `lng`, `phone`, `emergency_phone`, `is_live` (boolean), `onboarded_at`, `settings_id`.
**IX:** `(district)`, GiST on `(lat,lng)` via `earthdistance` or PostGIS `geography`.

#### `hospital_settings`
`hospital_id` **PK/FK**, `no_show_grace_patients` (default 2), `no_show_grace_minutes` (15), `late_reinsert_after` (3), `stale_threshold_minutes` (10), `refund_policy` jsonb, `sms_budget_monthly` int, `prepay_required` boolean, `numeral_style` text, `density_default` text.

#### `departments`
`id`, `hospital_id` **FK**, `name_bn`, `name_en`, `code`, `sort_order`.

#### `doctors`
`id`, `full_name_bn`, `full_name_en`, `bmdc_number` **U**, `bmdc_verified_at`, `degrees`, `specialties` text[], `photo_url`, `default_consult_minutes` int (seed for `FR-QUE-10`), `user_id` **FK** nullable (doctor's own login).

#### `doctor_hospitals`
`id`, `doctor_id` **FK**, `hospital_id` **FK**, `department_id` **FK**, `fee_poisha` int, `room` text, `is_active`.
**U:** `(doctor_id, hospital_id, department_id)`

#### `capabilities`
`id`, `hospital_id` **FK**, `kind` capability_kind, `is_available` boolean, `updated_by` **FK** → `staff_users.id`, `updated_at`.
**U:** `(hospital_id, kind)` — this table feeds emergency search (`FR-EMG-05`).

---

### 2.3 Sessions, bookings, queue

#### `sessions`
The central operational object (`FR-QUE-01`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `hospital_id` | uuid | **FK** |
| `doctor_id` | uuid | **FK** |
| `department_id` | uuid | **FK** |
| `room` | text | |
| `session_date` | date | |
| `planned_start` | timestamptz | |
| `planned_end` | timestamptz | |
| `actual_start` | timestamptz | set by `DOCTOR_ARRIVED` |
| `actual_end` | timestamptz | |
| `status` | session_status | |
| `capacity` | int | serials offered; null = unlimited |
| `fee_poisha` | int | copied from `doctor_hospitals` at creation |
| `delay_minutes` | int | current cumulative declared delay |
| `avg_consult_seconds` | int | rolling rate (`FR-QUE-12`) |
| `last_event_seq` | bigint | mirrors the highest event sequence |

**IX:** `(hospital_id, session_date)`, `(doctor_id, session_date)`, `(status)`

#### `session_templates`
Recurring chamber schedules: `id`, `doctor_hospital_id` **FK**, `weekday` int, `start_time` time, `end_time` time, `capacity`, `active_from`, `active_to`. A nightly job materialises `sessions` from templates.

#### `bookings`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `session_id` | uuid | **FK** |
| `patient_id` | uuid | **FK** |
| `booked_by_user_id` | uuid | **FK** nullable |
| `booked_by_guest_id` | uuid | **FK** nullable |
| `serial_number` | int | per-session |
| `status` | booking_status | |
| `source` | booking_source | |
| `intake` | jsonb | pre-visit answers (`FR-PAT-33` / `FR-DOC-03`) |
| `reason_text` | text | |
| `fee_poisha` | int | |
| `payment_id` | uuid | **FK** nullable |
| `called_at`, `done_at`, `arrived_at` | timestamptz | |
| `consult_seconds` | int | measured, feeds the rate |
| `cancelled_reason` | text | |

**U:** `(session_id, serial_number)` where `status <> 'cancelled'`
**IX:** `(patient_id)`, `(session_id, status)`, `(booked_by_guest_id)`

#### `queue_events` — append-only (`DB-P1`)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `seq` | bigserial | **U** per session via `(session_id, seq)` |
| `session_id` | uuid | **FK**, **IX** |
| `type` | queue_event_type | |
| `booking_id` | uuid | **FK** nullable |
| `actor_staff_id` | uuid | **FK** nullable |
| `actor_user_id` | uuid | **FK** nullable |
| `actor_role` | staff_role | nullable |
| `payload` | jsonb | type-specific (see §3) |
| `client_ts` | timestamptz | from the console, may be offline-old |
| `server_ts` | timestamptz | authoritative ordering |
| `client_event_id` | uuid | **U** — idempotency for offline replay (`FR-QUE-51`) |
| `undone_by_event_id` | uuid | set when compensated |

**No UPDATE, no DELETE.** Enforced by a rule/trigger and by RLS.
**IX:** `(session_id, seq)`, `(session_id, server_ts)`, `(client_event_id)`

#### `queue_state` — derived cache
`session_id` **PK/FK**, `now_serving_booking_id`, `now_serving_serial`, `waiting_count`, `late_count`, `no_show_count`, `done_count`, `avg_consult_seconds`, `projected_end`, `rebuilt_from_seq`, `updated_at`.
Rebuildable with `SELECT rebuild_queue_state(session_id)`.

#### `standby_list` / `slot_offers` (`FR-QUE-30`)
`standby_list`: `id`, `session_id`, `patient_id`, `contact_phone`, `position`, `created_at`, `removed_at`.
`slot_offers`: `id`, `session_id`, `freed_booking_id`, `offered_to_patient_id`, `offered_at`, `expires_at`, `accepted_at`, `declined_at`, `recovered_value_poisha`.

---

### 2.4 Clinical records

#### `visits`
One completed consultation: `id`, `booking_id` **FK U**, `patient_id`, `hospital_id`, `doctor_id`, `diagnosis_text`, `advice_text_bn`, `follow_up_date`, `signed_at`, `created_by`.

#### `prescriptions` / `prescription_items`
`prescriptions`: `id`, `visit_id` **FK**, `pdf_url`, `qr_token_hash`, `dispensed_at`.
`prescription_items`: `id`, `prescription_id` **FK**, `medicine_id` **FK** nullable, `name_text`, `strength`, `schedule` (`1+0+1`), `duration_days`, `instruction_bn`.

#### `medicines`
Formulary for autocomplete (`FR-DOC-05`): `id`, `generic_name`, `brand_name`, `manufacturer`, `strengths` text[], `form`.

#### `test_orders` / `reports`
`test_orders`: `id`, `visit_id` nullable, `patient_id`, `hospital_id`, `test_code`, `test_name`, `state` test_state, `ordered_by`, `sample_at`, `ready_at`, `delivered_at`, `price_poisha`.
`reports`: `id`, `test_order_id` **FK**, `file_url`, `file_type`, `uploaded_by`, `delivered_to_wallet_at`.

#### `patient_documents`
Patient-uploaded paper records (`FR-PAT-62`): `id`, `patient_id`, `file_url`, `doc_type`, `doc_date`, `doctor_name_text`, `uploaded_at`.

#### `consents` (`FR-PAT-64`)
`id`, `patient_id`, `hospital_id`, `doctor_id` nullable, `scope` consent_scope, `granted_at`, `expires_at`, `revoked_at`, `granted_via` (`qr`,`app`,`counter`).

---

### 2.5 Beds, emergency, referrals

#### `wards`
`id`, `hospital_id`, `name_bn`, `name_en`, `floor` (smallint, 0 = ground), `kind` bed_kind.
**U:** `(id, hospital_id)` — the target of `beds`' composite foreign key.

#### `beds`
`id`, `hospital_id`, `ward_id`, `label` (`301`), `kind` bed_kind, `state` bed_state, `nightly_poisha`, `last_cleaned_at`, `expected_discharge_date`, `current_admission_id`, `reserved_until`, `oos_reason`, `state_changed_at`.
**IX:** `(hospital_id, kind, state)` — powers public bed counts.
`(ward_id, hospital_id)` references `wards (id, hospital_id)`, so a bed cannot be filed under another hospital's ward. CHECKs make each state say what it must: occupied ⇔ `current_admission_id`, reserved ⇔ `reserved_until`, out of service ⇔ a non-blank `oos_reason`; a discharge forecast only on an occupied bed.
`reserved_until` and `oos_reason` exist because `BTN-B06-RESERVE` ("hold with expiry") and `BTN-B06-OOS` ("with reason") need them somewhere a query can read — the public view counts a lapsed hold as free. `state_changed_at` drives the cleaning timer and "occupied for N days".

#### `bed_events`
Append-only like the queue: `id`, `hospital_id`, `bed_id`, `type` (`ADMIT`,`DISCHARGE`,`TRANSFER`,`RESERVE`,`RELEASE`,`CLEAN_START`,`CLEAN_DONE`,`OOS`,`RESTORE`), `from_state`, `to_state`, `admission_id`, `bed_request_id`, `actor_staff_id`, `payload`, `client_event_id` **U** (partial), `client_ts`, `server_ts`.
`beds.state` is the present and this is how it got there; both are written in one transaction with the bed locked. `hospital_id` serves the freshness read (DB-P8); `from_state`/`to_state` let a CHECK refuse an event whose type and outcome disagree; `client_event_id` makes an offline replay a no-op (SY-02). `actor_staff_id` is null only on a `RELEASE` of a lapsed hold. Guarded by `trg_bed_events_no_mutate` and `trg_bed_events_no_truncate`, as `queue_events` is.

#### `admissions`
`id`, `patient_id`, `hospital_id`, `bed_id`, `admitted_at`, `discharged_at`, `expected_discharge_date`, `source` (`er`,`opd`,`app_request`,`referral`), `emergency_case_id` nullable, `bed_request_id` nullable.
**U:** one open admission per bed, and one per patient.

#### `bed_requests` (`FR-PAT-52`)
`id`, `patient_id`, `hospital_id`, `bed_kind`, `requested_by_user_id`/`guest_id`, `note`, `expected_arrival_at`, `state` (`requested`,`held`,`confirmed`,`declined`,`expired`), `bed_id`, `hold_expires_at`, `responded_by`, `responded_at`, `idempotency_key` **U**.
A hold is a real bed: `held` requires `bed_id` and `hold_expires_at`, and the bed is `reserved` until then — otherwise the public count would not know about the promise. `confirmed` means admitted. **U:** one open request per patient per hospital; one hold per bed.

#### `emergency_cases`
`id`, `hospital_id`, `patient_id` nullable (anonymous allowed, `FR-GST-03`), `contact_phone` nullable, `problem_type`, `state` emergency_state, `triage` triage_color, `inbound_eta_minutes`, `inbound_at`, `acknowledged_at`, `arrived_at`, `token_label`, `notes`.

#### `referrals`
`id`, `from_hospital_id`, `to_hospital_id`, `emergency_case_id` nullable, `patient_id` nullable, `required_capability` capability_kind, `summary` jsonb, `state` referral_state, `sent_at`, `seen_at`, `responded_at`, `arrived_at`, `decline_reason`.

---

### 2.6 Money

#### `payments`
`id`, `booking_id`/`bed_request_id`/`test_order_id`/`ambulance_request_id` (exactly one, CHECK), `payer_user_id`/`payer_guest_id`, `amount_poisha`, `platform_fee_poisha`, `method` payment_method, `state` payment_state, `provider_ref`, `idempotency_key` **U** (`FR-PAY-06`), `paid_at`, `refunded_poisha`, `refund_reason`.

#### `invoices` / `subscriptions`
`subscriptions`: `id`, `hospital_id`, `plan`, `modules` text[], `monthly_poisha`, `started_at`, `ended_at`, `state`.
`invoices`: `id`, `hospital_id`, `period_start`, `period_end`, `subscription_poisha`, `booking_fee_poisha`, `total_poisha`, `state`, `issued_at`, `paid_at`.

#### `counter_shifts` (`FR-REC-23`)
`id`, `hospital_id`, `counter_code`, `staff_user_id`, `opened_at`, `closed_at`, `expected_poisha`, `collected_poisha`, `variance_note`.

---

### 2.7 Messaging, feedback, audit

#### `notification_templates`
`key` **PK** (`queue.called`), `channel`, `locale`, `body`, `version`, `is_active` (`FR-NOT-05`).

#### `notifications`
`id`, `recipient_patient_id`/`guest_id`/`user_id`, `phone`, `channel` notif_channel, `template_key`, `params` jsonb, `state` notif_state, `provider_ref`, `cost_poisha`, `queued_at`, `sent_at`, `delivered_at`, `error`.
**IX:** `(state, queued_at)`, `(recipient_patient_id)`

#### `device_tokens`
`id`, `user_id`/`guest_id`, `token`, `platform`, `last_seen_at`, `revoked_at`.

#### `feedback`
`id`, `visit_id`, `patient_id`, `hospital_id`, `wait_score`, `doctor_score`, `cleanliness_score`, `billing_score`, `comment`, `created_at`.

#### `audit_log` (`DB-P7`)
`id`, `actor_staff_id`/`actor_user_id`, `hospital_id`, `action` (`RECORD_VIEW`,`QUEUE_ACTION`,`SETTINGS_CHANGE`,`EXPORT`,`LOGIN`), `subject_table`, `subject_id`, `patient_id` nullable, `ip`, `user_agent`, `meta` jsonb, `created_at`.
**IX:** `(patient_id, created_at)`, `(hospital_id, created_at)`

#### `sync_cursors`
Offline consoles: `id`, `device_id`, `staff_user_id`, `hospital_id`, `last_ack_seq` per session jsonb, `last_sync_at`.

---

### 2.8 Ancillary services

`ambulances`: `id`, `hospital_id` nullable, `operator_name`, `kind` (`basic`,`als`,`freezer`), `plate`, `driver_name`, `driver_phone`, `base_fare_poisha`, `per_km_poisha`, `is_available`.
`ambulance_requests`: `id`, `requester_user_id`/`guest_id`, `pickup_lat/lng`, `destination_hospital_id`, `kind`, `quoted_fare_poisha` (locked, `FR-PAT-74`), `state`, `dispatched_at`, `completed_at`.
`blood_donors`: `id`, `user_id` nullable, `name`, `phone`, `blood_group`, `district`, `last_donation_date`, `is_available`.
`blood_requests`: `id`, `patient_id` nullable, `hospital_id`, `blood_group`, `units`, `urgency`, `state`, `fulfilled_at`.
`pharmacy_stock`: `id`, `hospital_id`, `medicine_id`, `in_stock` boolean, `updated_at`.

---

## 3. Event payload contracts

Stored in `queue_events.payload`. These shapes are shared with the client via `shared/domain` — the same TypeScript types validate both sides.

```jsonc
DOCTOR_ARRIVED      { "arrivedAt": "2026-09-17T11:12:00Z", "minutesLate": 12 }
DELAY_DECLARED      { "minutes": 30, "reason": "surgery", "declaredBy": "doctor|reception" }
SESSION_PAUSED      { "reason": "prayer" }
PATIENT_CALLED      { "bookingId": "…", "serial": 13 }
PATIENT_DONE        { "bookingId": "…", "consultSeconds": 372 }
PATIENT_LATE        { "bookingId": "…", "expectedMinutes": 20, "reinsertAfter": 3 }
PATIENT_NO_SHOW     { "bookingId": "…", "graceUsedMinutes": 17 }
PATIENT_REINSERTED  { "bookingId": "…", "newPosition": 19 }
WALKIN_ADDED        { "bookingId": "…", "position": "end|index", "index": 15 }
SLOT_OFFERED        { "freedBookingId": "…", "offeredTo": ["patientId"], "expiresAt": "…" }
SLOT_ACCEPTED       { "offerId": "…", "newBookingId": "…" }
PRIORITY_REORDERED  { "bookingId": "…", "fromIndex": 22, "toIndex": 14, "reason": "elderly" }
ACTION_UNDONE       { "undoneEventId": "…" }
```

---

## 4. Views and functions

| Object | Type | Purpose |
|---|---|---|
| `v_public_hospital_capacity` | view | Per hospital: free beds by kind with nightly price range and each kind's `asOf`, bed and ICU totals, active ER cases, capability flags — the only source the public API reads (`FR-PAT-14`). "Free" includes a reserved bed whose hold has lapsed; a bed out of service is in neither the free count nor the total. Freshness is two stamps, not one `as_of`: `beds_as_of` (the **oldest** kind's latest `bed_events.server_ts`, null if any kind was never confirmed) and `capability_as_of` — confirmed by different people at different times. Migration 0012. |
| `v_doctor_live_status` | view | Per doctor today: in chamber / expected / not sitting, with current serial |
| `v_admin_daily` | materialised view | Daily aggregates per hospital for the dashboard; refreshed every 5 min |
| `v_no_show_loss` | view | No-show count × fee, and recovered value from `slot_offers` (`FR-ADM-03`) |
| `v_referral_flow` | view | Sent / accepted / leaked per hospital |
| `fn_rebuild_queue_state(session_id)` | function | Replays `queue_events` → writes `queue_state` (`DB-P1`) |
| `fn_next_serial(session_id)` | function | Allocates the next serial atomically |
| `fn_recalc_etas(session_id)` | function | Returns `[{bookingId, etaAt, bandMinutes}]` (`FR-QUE-11`) |
| `fn_nearby_hospitals(lat,lng,capability,radius)` | function | Emergency ranking (`FR-PAT-43`) |
| `trg_queue_events_no_mutate` | trigger | Blocks UPDATE/DELETE on the event log |
| `trg_touch_updated_at` | trigger | Maintains `updated_at` everywhere |
| `trg_booking_status_from_events` | trigger | Keeps `bookings.status` consistent with the latest event |

---

## 5. Row-level security

Enabled on every table. Core policies:

| Table | Policy |
|---|---|
| `patients` | Patient reads own (`owner_user_id = auth.uid()`); guest reads via valid `guest_links` token claim; staff reads only when a booking for that patient exists in their hospital today, or a valid `consents` row exists |
| `bookings` | Owner (user or guest) reads own; staff reads within `hospital_id` scope |
| `queue_events` | INSERT: staff in scope, or patient for `PATIENT_LATE`/`BOOKING_CANCELLED` on own booking. SELECT: staff in scope; patients get derived state through the API only, never the raw log |
| `visits`, `prescriptions`, `reports` | Patient reads own; treating doctor reads with consent; hospital admin reads aggregate only |
| `beds`, `capabilities` | Staff writes in scope; public reads through `v_public_hospital_capacity` only |
| `audit_log` | Insert-only for services; readable by `hospital_admin` (own hospital) and `platform_admin` |
| Everything gov | `gov_viewer` may read only the aggregate views, never base tables (`FR-GOV-06`) |

Service-role key is used only by backend workers, never exposed to any client.

---

## 6. Indexing and performance notes

- Hot path is `queue_events(session_id, seq)` — covering index, and `queue_state` is read for display rather than replaying events per request.
- `bookings(session_id, status)` partial index on `status IN ('booked','waiting','late')`.
- `beds(hospital_id, kind, state)` supports the public capacity view without a scan.
- `notifications(state, queued_at)` partial on `state='queued'` for the worker.
- Geospatial: `hospitals` uses `geography(Point,4326)` with a GiST index; emergency search filters by radius first, then ranks.
- Partition `queue_events` and `audit_log` by month once either exceeds ~50M rows.
- `avg_consult_seconds` is maintained incrementally on `PATIENT_DONE`, never recomputed by full scan.

---

## 7. Migration files

Sequential, forward-only, one concern per file. Never edit a shipped migration.

```
/db
  /migrations
    0001_extensions.sql            -- uuid-ossp/pgcrypto, postgis, earthdistance
    0002_enums.sql
    0003_identity.sql              -- users, guest_identities, patients, staff_users, staff_roles, sessions_auth, guest_links
    0004_facilities.sql            -- hospitals, hospital_settings, departments, doctors, doctor_hospitals, capabilities
    0005_sessions_bookings.sql     -- session_templates, sessions, bookings
    0006_queue_events.sql          -- queue_events, queue_state, standby_list, slot_offers, no-mutate trigger
    0007_clinical.sql              -- visits, prescriptions, prescription_items, medicines, test_orders, reports, patient_documents, consents
    0008_beds_emergency.sql        -- wards, beds, bed_events, admissions, bed_requests, emergency_cases, referrals
    0009_money.sql                 -- payments, subscriptions, invoices, counter_shifts
    0010_messaging_audit.sql       -- notification_templates, notifications, device_tokens, feedback, audit_log, sync_cursors
    0011_ancillary.sql             -- ambulances, ambulance_requests, blood_donors, blood_requests, pharmacy_stock
    0012_views.sql                 -- v_public_hospital_capacity (step 14). Later views each get
                                   -- their own migration with the step that reads them: a shipped
                                   -- migration is never edited, and v_admin_daily needs 0009
    0013_functions.sql             -- fn_* functions and remaining triggers
    0014_rls.sql                   -- enable RLS + all policies
    0015_indexes.sql               -- non-PK indexes gathered in one place
  /seeds
    seed_00_reference.sql          -- districts, capability list, medicine formulary sample
    seed_01_hospitals.ts           -- 6 facilities (FR-DEM-01)
    seed_02_doctors_sessions.ts    -- 40 doctors, templates, today's sessions (FR-DEM-02)
    seed_03_patients.ts            -- 200 profiles + guest identities (FR-DEM-03)
    seed_04_history.ts             -- 500 past visits, prescriptions, reports
    seed_05_beds.ts                -- wards, beds, occupancy (FR-DEM-04)
    seed_06_ancillary.ts           -- ambulances, donors, pharmacy stock (FR-DEM-05)
    seed_07_demo_live.ts           -- puts one session mid-queue for the pitch (FR-DEM-06)
    reset.ts                       -- truncate + reseed in one command
  /scripts
    rebuild_queue_state.ts
    verify_schema.ts               -- asserts every table has created_at/updated_at/RLS
```

**Commands:** `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:reset`, `pnpm db:verify`.

---

## 8. Data retention and privacy

| Data | Retention | Rule |
|---|---|---|
| `queue_events` | ≥ 2 years (`NFR-09`) | never edited |
| `audit_log` | ≥ 2 years | append-only |
| Clinical records | indefinite unless deletion requested | `FR-SEC-09` |
| `guest_links` | session end + 30 days | then revoked |
| Unclaimed guest records | 24 months, then anonymised | phone hashed, clinical content retained for the hospital |
| `notifications` bodies | 90 days | metadata kept |
| Demo/prototype DB | contains no real data, ever (`FR-SEC-08`) | separate project |

Deletion request: `fn_erase_patient(patient_id)` nulls identifiers, retains financial and audit rows with a tombstone reference (legal requirement), and writes an `audit_log` entry.

---

*End of `DATABASE.md`. See `BACKEND.md` for the services that write to this schema and `FRONTEND.md` for the clients that read it.*
