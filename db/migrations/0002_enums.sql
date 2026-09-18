-- 0002_enums.sql
--
-- Every enum in DATABASE.md §1, in that order and with those labels exactly.
--
-- These types are mirrored by `packages/domain/src/types/enums.ts` and are
-- therefore a contract, not an implementation detail: the same labels travel
-- through the event log, the realtime payloads and the client. `db:verify`
-- asserts the label sets still match, so a silently added value fails CI
-- rather than reaching a console as an unhandled case.
--
-- Adding a label later: `ALTER TYPE ... ADD VALUE` in a new migration, and add
-- it to the domain union in the same branch. Never reorder or rename.

CREATE TYPE user_kind         AS ENUM ('patient','guest','staff','platform');

CREATE TYPE sex               AS ENUM ('male','female','other');

CREATE TYPE staff_role        AS ENUM (
  'receptionist','doctor','ward','emergency','lab','pharmacy',
  'hospital_admin','platform_admin','gov_viewer'
);

CREATE TYPE facility_kind     AS ENUM ('hospital','clinic','diagnostic','government');

CREATE TYPE session_status    AS ENUM ('scheduled','running','paused','ended','cancelled');

CREATE TYPE booking_status    AS ENUM (
  'booked','waiting','in_chamber','done','late','no_show','cancelled','rescheduled'
);

CREATE TYPE booking_source    AS ENUM ('app','guest_link','counter','phone','walkin');

-- The 18 facts that can be true about a session (FR-QUE-03, plus SLOT_EXPIRED
-- and ACTION_UNDONE). The queue is derived from these and nothing else (DB-P1).
-- `@typescript-eslint/switch-exhaustiveness-check` is enabled repo-wide so that
-- the reducer cannot quietly ignore one of them.
CREATE TYPE queue_event_type  AS ENUM (
  'SESSION_OPENED','DOCTOR_ARRIVED','DELAY_DECLARED','SESSION_PAUSED','SESSION_RESUMED',
  'PATIENT_CALLED','PATIENT_DONE','PATIENT_LATE','PATIENT_NO_SHOW','PATIENT_REINSERTED',
  'WALKIN_ADDED','BOOKING_CANCELLED','SLOT_OFFERED','SLOT_ACCEPTED','SLOT_EXPIRED',
  'PRIORITY_REORDERED','SESSION_ENDED','ACTION_UNDONE'
);

CREATE TYPE bed_kind          AS ENUM (
  'general','cabin','hdu','icu','ccu','nicu','isolation','burn'
);

CREATE TYPE bed_state         AS ENUM ('free','occupied','cleaning','reserved','out_of_service');

CREATE TYPE triage_color      AS ENUM ('red','yellow','green');

CREATE TYPE emergency_state   AS ENUM (
  'inbound','acknowledged','arrived','in_treatment','admitted','discharged','referred','cancelled'
);

CREATE TYPE referral_state    AS ENUM ('sent','seen','accepted','declined','arrived','cancelled');

CREATE TYPE test_state        AS ENUM (
  'ordered','sample_collected','processing','report_ready','delivered','cancelled'
);

CREATE TYPE payment_method    AS ENUM ('bkash','nagad','card','cash','at_hospital');

CREATE TYPE payment_state     AS ENUM ('pending','paid','failed','refunded','partially_refunded');

CREATE TYPE notif_channel     AS ENUM ('push','sms','ivr','in_app');

CREATE TYPE notif_state       AS ENUM ('queued','sent','delivered','failed','skipped');

CREATE TYPE capability_kind   AS ENUM (
  'burn_unit','cardiac','cath_lab','stroke','dialysis','nicu','trauma_ot',
  'blood_bank','ambulance','isolation'
);

CREATE TYPE consent_scope     AS ENUM ('visit','hospital','doctor','full');
