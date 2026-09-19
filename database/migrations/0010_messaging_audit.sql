-- 0010_messaging_audit.sql
--
-- What the platform says to people, and what it records about having said it.
--
-- DATABASE.md §2.7. Four of that section's six tables are created here;
-- `feedback` is not, and the reason is stated at the foot of this file.
--
-- ## Why this arrives before 0007–0009
--
-- The build order (CLAUDE.md §4) reaches notifications at step 11, while
-- clinical records, beds and money are steps 12, 14 and 18. Nothing below
-- depends on any of those, so this migration applies cleanly against the 0006
-- schema and the later files apply cleanly on top of it — the runner applies
-- whatever a database has not seen, in filename order, so a fresh build and an
-- incrementally migrated one converge on the same schema either way.
--
-- ## The notifications table is an outbox
--
-- A row is written inside the same transaction as the queue event that caused
-- it, with `state = 'queued'`. Sending happens afterwards, outside the lock:
-- an SMS gateway taking four seconds must never hold the session row that
-- every counter in the hospital is waiting on.
--
-- That ordering is also what makes the promise in FR-NOT-03 keepable. If the
-- transaction rolls back, no message was queued and none is sent. If the
-- process dies between commit and send, the row is still sitting there marked
-- `queued` and the partial index below is exactly the query a worker needs to
-- find it. Nothing is lost and nothing is sent twice.

-- ===========================================================================
-- notification_templates — FR-NOT-04, FR-NOT-05
--
-- "Templates are versioned and centrally managed, never hard-coded at call
-- sites." A call site names a key and supplies parameters; what a patient
-- actually reads is a row here.
--
-- The primary key spans key, channel and locale because one event produces
-- different text on different channels: an SMS carries the tracking link and
-- has 160 characters to do it in, while a push notification has a title and a
-- body and the app already knows which booking it is about.
-- ===========================================================================

CREATE TABLE notification_templates (
  key          text          NOT NULL,
  channel      notif_channel NOT NULL,

  -- FR-LOC-01 / I18N-01: two locales, `bn` default. Not a negotiation
  -- framework, so this is a CHECK rather than a table of languages.
  locale       text          NOT NULL,

  -- The text, with `{placeholders}` the service substitutes. Kept as one
  -- column rather than title/body: SMS has no title, and a nullable column
  -- that is mandatory for one channel and meaningless for another is a worse
  -- description of the thing than a single body plus a convention.
  body         text          NOT NULL,

  -- FR-NOT-05: versioned. A change ships as a new version of the same key, so
  -- a notification row sent last week can still be explained by the text that
  -- was live when it was sent.
  version      integer       NOT NULL DEFAULT 1,
  is_active    boolean       NOT NULL DEFAULT true,

  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now(),

  PRIMARY KEY (key, channel, locale),

  CONSTRAINT notification_templates_locale_allowed CHECK (locale IN ('bn', 'en')),
  CONSTRAINT notification_templates_version_positive CHECK (version > 0),
  CONSTRAINT notification_templates_body_not_blank CHECK (btrim(body) <> ''),

  -- Templates are platform copy, not a place to put a person's details. A
  -- body is a form letter; the parameters that fill it live on the
  -- notification row and are subject to that row's retention (DATABASE.md §8).
  CONSTRAINT notification_templates_key_shape CHECK (key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);

CREATE TRIGGER trg_notification_templates_touch
  BEFORE UPDATE ON notification_templates
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE notification_templates IS
  'Versioned message copy in bn and en, per channel (FR-NOT-04, FR-NOT-05). Never hard-coded at a call site.';

-- ===========================================================================
-- notifications — one row per message the platform decided to send
--
-- Written even when nothing goes out. A message suppressed by quiet hours
-- (FR-NOT-07) or by a hospital's SMS cap (FR-NOT-06) is recorded as `skipped`
-- with the reason, because "we chose not to tell them" is a fact a hospital
-- needs when a patient says nobody called.
-- ===========================================================================

CREATE TABLE notifications (
  id                    uuid          PRIMARY KEY DEFAULT uuid_generate_v7(),

  -- Who it is for. At most one of these three: a patient record is the usual
  -- answer, a guest identity covers somebody with no account, and a user is
  -- for messages about an account rather than about a visit.
  recipient_patient_id  uuid          REFERENCES patients (id) ON DELETE CASCADE,
  recipient_guest_id    uuid          REFERENCES guest_identities (id) ON DELETE CASCADE,
  recipient_user_id     uuid          REFERENCES users (id) ON DELETE CASCADE,

  -- DB-P6. Denormalised deliberately: this is the number the message actually
  -- went to, and a patient who later changes their phone must not rewrite the
  -- history of where a message was sent.
  phone                 text,

  channel               notif_channel NOT NULL,
  template_key          text          NOT NULL,

  -- What filled the template's placeholders — a serial, a doctor's name, a
  -- time. Subject to the 90-day body retention in DATABASE.md §8.
  params                jsonb         NOT NULL DEFAULT '{}'::jsonb,

  state                 notif_state   NOT NULL DEFAULT 'queued',

  -- The aggregator's id for the message, for delivery reporting (FR-NOT-06).
  provider_ref          text,
  cost_poisha           integer,

  -- Why a message was not sent: a quiet-hours suppression, a budget cap, a
  -- missing phone number, or a provider failure. Text rather than an enum
  -- because the provider half of it is not ours to enumerate.
  error                 text,

  queued_at             timestamptz   NOT NULL DEFAULT now(),
  sent_at               timestamptz,
  delivered_at          timestamptz,

  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT notifications_one_recipient
    CHECK (num_nonnulls(recipient_patient_id, recipient_guest_id, recipient_user_id) <= 1),

  CONSTRAINT notifications_phone_normalised
    CHECK (phone IS NULL OR phone ~ '^\+8801[3-9][0-9]{8}$'),

  CONSTRAINT notifications_cost_non_negative
    CHECK (cost_poisha IS NULL OR cost_poisha >= 0),

  -- An SMS needs somewhere to go. Push does not: it goes to whatever device
  -- tokens the recipient has registered.
  CONSTRAINT notifications_sms_has_phone
    CHECK (channel <> 'sms' OR phone IS NOT NULL OR state = 'skipped'),

  -- Delivery follows sending. A provider reporting delivery for a message we
  -- never sent is a bug worth failing on rather than storing.
  CONSTRAINT notifications_delivered_after_sent
    CHECK (delivered_at IS NULL OR (sent_at IS NOT NULL AND delivered_at >= sent_at)),

  -- A settled state says when, or why, or both. `queued` says neither yet.
  CONSTRAINT notifications_settled_state_explained
    CHECK (
      state <> 'sent'    OR sent_at IS NOT NULL
    ),
  CONSTRAINT notifications_failure_explained
    CHECK (state NOT IN ('failed', 'skipped') OR error IS NOT NULL)
);

-- DATABASE.md §4: partial on `state='queued'`, for the worker. This is the
-- outbox query and the only one that runs on a schedule.
CREATE INDEX notifications_pending_idx
  ON notifications (queued_at)
  WHERE state = 'queued';

CREATE INDEX notifications_recipient_idx ON notifications (recipient_patient_id, queued_at DESC);

-- Delivery reporting and the monthly cap are both per hospital, but a
-- notification belongs to a person rather than a facility. The template key
-- plus the month is what a budget report groups by (FR-NOT-06).
CREATE INDEX notifications_template_idx ON notifications (template_key, queued_at DESC);

CREATE TRIGGER trg_notifications_touch
  BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE notifications IS
  'Outbox and record of every message the platform decided to send, including the ones it decided not to (FR-NOT-03, FR-NOT-06, FR-NOT-07).';

COMMENT ON COLUMN notifications.phone IS
  'The number the message actually went to (DB-P6). Denormalised so history is not rewritten when a patient changes their number.';

-- ===========================================================================
-- device_tokens — where a push notification goes (FR-NOT-01, FR-NOT-02)
--
-- Web Push (VAPID) for the PWA, per BACKEND.md §0. A token belongs to an
-- installed app on one device, so a person with a phone and a tablet has two,
-- and revoking is a timestamp rather than a delete (DB-P2).
-- ===========================================================================

CREATE TABLE device_tokens (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),

  user_id       uuid        REFERENCES users (id) ON DELETE CASCADE,
  guest_id      uuid        REFERENCES guest_identities (id) ON DELETE CASCADE,

  -- The Web Push endpoint plus its keys, as the browser hands them over.
  token         text        NOT NULL,
  platform      text        NOT NULL DEFAULT 'web',

  last_seen_at  timestamptz,
  revoked_at    timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT device_tokens_one_owner
    CHECK (num_nonnulls(user_id, guest_id) = 1),

  CONSTRAINT device_tokens_platform_allowed
    CHECK (platform IN ('web', 'android', 'ios')),

  CONSTRAINT device_tokens_token_not_blank CHECK (btrim(token) <> '')
);

-- One registration per device. A browser that re-subscribes with the same
-- endpoint updates its row rather than accumulating duplicates, which is what
-- would otherwise send one person the same notice five times.
CREATE UNIQUE INDEX device_tokens_token_key
  ON device_tokens (token) WHERE revoked_at IS NULL;

CREATE INDEX device_tokens_user_idx ON device_tokens (user_id) WHERE revoked_at IS NULL;
CREATE INDEX device_tokens_guest_idx ON device_tokens (guest_id) WHERE revoked_at IS NULL;

CREATE TRIGGER trg_device_tokens_touch
  BEFORE UPDATE ON device_tokens
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- audit_log — DB-P7, FR-SEC-03
--
-- "Every patient-identifying read by staff writes to audit_log."
--
-- Created here because DATABASE.md §2.7 puts it here and it depends on nothing
-- later. `middleware/audit.ts` is not written yet — that is the step that
-- makes DB-P7 true, and it now has a table to write to.
--
-- Append-only in spirit rather than by trigger: unlike `queue_events`, no
-- product behaviour is derived from this table, so the guard that matters is
-- RLS keeping staff from reading each other's hospitals rather than a
-- no-mutate trigger.
-- ===========================================================================

CREATE TABLE audit_log (
  id              uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),

  actor_staff_id  uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  actor_user_id   uuid        REFERENCES users (id) ON DELETE SET NULL,
  hospital_id     uuid        REFERENCES hospitals (id) ON DELETE CASCADE,

  action          text        NOT NULL,
  subject_table   text        NOT NULL,
  subject_id      uuid,

  -- Nullable: a settings change or an export has no single patient behind it.
  -- When it is set, this is the column the subject-access report reads.
  patient_id      uuid        REFERENCES patients (id) ON DELETE SET NULL,

  ip              inet,
  user_agent      text,
  meta            jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at      timestamptz NOT NULL DEFAULT now(),

  -- DB-P3 has no exceptions, so this column exists — and on this table it
  -- will always equal `created_at`, because nothing updates an audit row and
  -- nothing should. Its value is that the invariant stays universal: a rule
  -- with one exemption acquires a second.
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT audit_log_action_allowed
    CHECK (action IN ('RECORD_VIEW', 'QUEUE_ACTION', 'SETTINGS_CHANGE', 'EXPORT', 'LOGIN')),

  CONSTRAINT audit_log_meta_is_object CHECK (jsonb_typeof(meta) = 'object')
);

-- "Who looked at my record, and when" — the question DB-P7 exists to answer.
CREATE INDEX audit_log_patient_idx ON audit_log (patient_id, created_at DESC);
CREATE INDEX audit_log_hospital_idx ON audit_log (hospital_id, created_at DESC);

CREATE TRIGGER trg_audit_log_touch
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE audit_log IS
  'Every patient-identifying read by staff, and every consequential action (DB-P7, FR-SEC-03).';

-- ===========================================================================
-- sync_cursors — how far an offline console has caught up (BACKEND.md §5)
-- ===========================================================================

CREATE TABLE sync_cursors (
  id             uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),

  device_id      text        NOT NULL,
  staff_user_id  uuid        NOT NULL REFERENCES staff_users (id) ON DELETE CASCADE,
  hospital_id    uuid        NOT NULL REFERENCES hospitals (id) ON DELETE CASCADE,

  -- `{ "<sessionId>": <seq> }`. One row per device rather than per session,
  -- because a console works several chambers in a shift and reconnects once.
  last_ack_seq   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at   timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sync_cursors_last_ack_is_object CHECK (jsonb_typeof(last_ack_seq) = 'object')
);

CREATE UNIQUE INDEX sync_cursors_device_key ON sync_cursors (device_id, staff_user_id);

CREATE TRIGGER trg_sync_cursors_touch
  BEFORE UPDATE ON sync_cursors
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE sync_cursors ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- Deliberately not here: `feedback`
--
-- DATABASE.md §2.7 lists it in this file, and its first column after the id is
-- `visit_id` — a foreign key to `visits`, which migration 0007_clinical.sql
-- creates. That migration is build step 12.
--
-- Writing the table now would mean either dropping the foreign key, which
-- would let a rating attach to a visit that never happened, or inventing the
-- `visits` table three steps early. It lands with 0007, beside the visit it
-- rates and the "মতামত দিন" control in `APP_FLOW.md` S-A-09 that produces it.
-- ===========================================================================
