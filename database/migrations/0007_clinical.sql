-- 0007_clinical.sql
--
-- Clinical records: what a consultation leaves behind (DATABASE.md §2.4).
--
-- This is the migration that makes the product more than a queue. Everything
-- before it is about getting a patient in front of a doctor on time; this is
-- the first table whose rows a patient will still want in five years.
--
-- ## The one boundary that matters here
--
-- A queue row says where somebody is in a line. A `visits` row says what a
-- doctor concluded about their body. `DB-P7` therefore applies to every read of
-- these tables by staff, not only to writes: `audit_log` records who looked, and
-- `FR-DOC-10` limits looking to a doctor's own patients or an explicit consent.
-- The columns are ordinary; the access rules are not.
--
-- ## Prescriptions exist as tables and not as a feature
--
-- `prescriptions`, `prescription_items` and `medicines` are created here because
-- DATABASE.md §7 defines 0007 as this set of tables and a shipped migration is
-- never edited — leaving them out would mean a second clinical migration later
-- for tables already specified. The owner dropped e-prescriptions from this
-- version (`FR-DOC-04`, `FR-DOC-05`, `FR-DOC-07`), so nothing writes to them
-- yet. A visit's `diagnosis_text`, `advice_text_bn` and `follow_up_date` are the
-- record this version produces, and they live on `visits` itself.
--
-- ## Storage
--
-- `pdf_url`, `file_url` and the rest hold Supabase Storage object paths, never
-- public URLs (BACKEND.md §1: "signed URLs only"). A row here is a pointer plus
-- permission to ask for one.

-- ===========================================================================
-- visits — one completed consultation (DATABASE.md §2.4)
-- ===========================================================================

CREATE TABLE visits (
  id               uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),

  -- One visit per booking, which is what makes a double-signed consultation
  -- impossible rather than merely discouraged. A doctor who signs twice is
  -- refused by the database, and `clinical.service` turns that into an update
  -- of the draft it already wrote.
  booking_id       uuid        NOT NULL UNIQUE REFERENCES bookings (id) ON DELETE RESTRICT,

  -- Denormalised from the booking's session on purpose. A record outlives the
  -- operational rows around it, and `FR-DOC-10` and the RLS policies both ask
  -- "whose patient, whose hospital, which doctor" of the visit itself rather
  -- than through three joins.
  patient_id       uuid        NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  hospital_id      uuid        NOT NULL REFERENCES hospitals (id) ON DELETE RESTRICT,
  doctor_id        uuid        NOT NULL REFERENCES doctors (id) ON DELETE RESTRICT,

  -- Free text, not a code. `INP-B05-DX` allows free text and no document
  -- specifies a coding system; inventing one would put a doctor's conclusion
  -- into a vocabulary nobody agreed to.
  diagnosis_text   text,

  -- Bangla, because the patient reads it (`FR-DOC-07` in spirit: the
  -- patient-facing output is Bangla even though this version does not print).
  advice_text_bn   text,

  follow_up_date   date,

  -- Null while the visit is a draft. Signing is what makes a record a record
  -- (`BTN-B05-SIGN`), and `FR-DOC-08` ties it to advancing the queue.
  signed_at        timestamptz,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at       timestamptz,

  -- A signed visit says something. An empty one that claims to be signed is a
  -- record a patient could be shown with nothing in it, so signing requires
  -- that the doctor wrote at least one of the three fields.
  CONSTRAINT visits_signed_has_content
    CHECK (
      signed_at IS NULL
      OR num_nonnulls(diagnosis_text, advice_text_bn, follow_up_date) >= 1
    ),

  -- A follow-up in the past is a typo, and one a patient would be reminded
  -- about (`FR-PAT-80`).
  CONSTRAINT visits_follow_up_not_past
    CHECK (follow_up_date IS NULL OR follow_up_date >= (created_at AT TIME ZONE 'Asia/Dhaka')::date)
);

CREATE INDEX visits_patient_idx ON visits (patient_id, created_at DESC);
CREATE INDEX visits_doctor_idx ON visits (doctor_id, created_at DESC);
CREATE INDEX visits_hospital_idx ON visits (hospital_id, created_at DESC);

-- The wallet lists signed records only; a draft belongs to the doctor who is
-- still typing it (`S-A-12`).
CREATE INDEX visits_signed_idx ON visits (patient_id, signed_at DESC) WHERE signed_at IS NOT NULL;

CREATE TRIGGER trg_visits_touch
  BEFORE UPDATE ON visits
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE visits ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE visits IS
  'One completed consultation. The first table whose rows a patient still wants years later, and the reason FR-DOC-10 and DB-P7 exist.';
COMMENT ON COLUMN visits.signed_at IS
  'Null while a draft. Signing writes the record to the wallet and advances the queue (FR-DOC-08, BTN-B05-SIGN).';
COMMENT ON COLUMN visits.diagnosis_text IS
  'Free text by design: INP-B05-DX allows it and no document fixes a coding system.';

-- ===========================================================================
-- medicines — the formulary (FR-DOC-05, not built this version)
-- ===========================================================================

CREATE TABLE medicines (
  id             uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  generic_name   text        NOT NULL,
  brand_name     text,
  manufacturer   text,
  strengths      text[]      NOT NULL DEFAULT '{}',
  form           text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,

  CONSTRAINT medicines_generic_not_blank CHECK (btrim(generic_name) <> '')
);

-- Autocomplete is a prefix search over both names (`FR-DOC-05`).
CREATE INDEX medicines_generic_idx ON medicines (lower(generic_name));
CREATE INDEX medicines_brand_idx ON medicines (lower(brand_name)) WHERE brand_name IS NOT NULL;

CREATE TRIGGER trg_medicines_touch
  BEFORE UPDATE ON medicines
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE medicines ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE medicines IS
  'Formulary for FR-DOC-05 autocomplete. No hospital owns it, so it carries no hospital_id — the one operational table exempt from DB-P8.';

-- ===========================================================================
-- prescriptions / prescription_items (FR-DOC-04, not built this version)
-- ===========================================================================

CREATE TABLE prescriptions (
  id             uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  visit_id       uuid        NOT NULL UNIQUE REFERENCES visits (id) ON DELETE RESTRICT,

  -- A Supabase Storage object path, not a public URL (BACKEND.md §1).
  pdf_url        text,

  -- Only the hash. A pharmacy redeems the token it was given; the token itself
  -- is a credential and CLAUDE.md §7 forbids storing one.
  qr_token_hash  text,

  dispensed_at   timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at     timestamptz
);

CREATE INDEX prescriptions_dispensed_idx ON prescriptions (dispensed_at) WHERE dispensed_at IS NULL;

CREATE TRIGGER trg_prescriptions_touch
  BEFORE UPDATE ON prescriptions
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN prescriptions.qr_token_hash IS
  'Hash only. The token is a credential and is never stored (CLAUDE.md §7).';

CREATE TABLE prescription_items (
  id               uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  prescription_id  uuid        NOT NULL REFERENCES prescriptions (id) ON DELETE CASCADE,

  -- Nullable: a doctor may write a medicine the formulary does not carry, and
  -- refusing that would make the formulary an authority over prescribing.
  medicine_id      uuid        REFERENCES medicines (id) ON DELETE SET NULL,
  name_text        text        NOT NULL,

  strength         text,
  -- `1+0+1`: morning, midday, night. The notation every prescription in
  -- Bangladesh already uses (DATABASE.md §2.4).
  schedule         text,
  duration_days    integer,
  instruction_bn   text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,

  CONSTRAINT prescription_items_name_not_blank CHECK (btrim(name_text) <> ''),
  CONSTRAINT prescription_items_duration_positive
    CHECK (duration_days IS NULL OR duration_days BETWEEN 1 AND 365)
);

CREATE INDEX prescription_items_prescription_idx ON prescription_items (prescription_id);

CREATE TRIGGER trg_prescription_items_touch
  BEFORE UPDATE ON prescription_items
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE prescription_items ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN prescription_items.schedule IS
  'Free text in 1+0+1 form: morning, midday, night.';

-- ===========================================================================
-- test_orders / reports (FR-LAB-*, step 17)
-- ===========================================================================

CREATE TABLE test_orders (
  id             uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),

  -- Nullable: a patient may order a test without a consultation behind it
  -- (BACKEND.md §7.6, "doctor | patient booking").
  visit_id       uuid        REFERENCES visits (id) ON DELETE SET NULL,
  patient_id     uuid        NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  hospital_id    uuid        NOT NULL REFERENCES hospitals (id) ON DELETE RESTRICT,

  test_code      text        NOT NULL,
  test_name      text        NOT NULL,
  state          test_state  NOT NULL DEFAULT 'ordered',

  ordered_by     uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  sample_at      timestamptz,
  ready_at       timestamptz,
  delivered_at   timestamptz,
  price_poisha   integer     NOT NULL DEFAULT 0,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at     timestamptz,

  CONSTRAINT test_orders_price_non_negative CHECK (price_poisha >= 0),

  -- The states are ordered, so their timestamps are too. A report that was
  -- ready before its sample was taken is a data-entry error, not a workflow.
  CONSTRAINT test_orders_timeline_ordered
    CHECK (
      (ready_at IS NULL OR sample_at IS NULL OR ready_at >= sample_at)
      AND (delivered_at IS NULL OR ready_at IS NULL OR delivered_at >= ready_at)
    )
);

CREATE INDEX test_orders_patient_idx ON test_orders (patient_id, created_at DESC);
CREATE INDEX test_orders_hospital_state_idx ON test_orders (hospital_id, state);
CREATE INDEX test_orders_visit_idx ON test_orders (visit_id) WHERE visit_id IS NOT NULL;

CREATE TRIGGER trg_test_orders_touch
  BEFORE UPDATE ON test_orders
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE test_orders ENABLE ROW LEVEL SECURITY;

CREATE TABLE reports (
  id                       uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  test_order_id            uuid        NOT NULL REFERENCES test_orders (id) ON DELETE RESTRICT,

  file_url                 text        NOT NULL,
  file_type                text,
  uploaded_by              uuid        REFERENCES staff_users (id) ON DELETE SET NULL,

  -- `FR-LAB-03`: a report reaches the wallet without the patient chasing it.
  -- Null means it has not, which is the figure that makes the promise checkable.
  delivered_to_wallet_at   timestamptz,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz,

  CONSTRAINT reports_file_url_not_blank CHECK (btrim(file_url) <> '')
);

CREATE INDEX reports_test_order_idx ON reports (test_order_id);
CREATE INDEX reports_undelivered_idx ON reports (created_at) WHERE delivered_to_wallet_at IS NULL;

CREATE TRIGGER trg_reports_touch
  BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN reports.delivered_to_wallet_at IS
  'Null until FR-LAB-03 has been kept. The null count is how the promise is measured.';

-- ===========================================================================
-- patient_documents — paper the patient photographed (FR-PAT-62)
-- ===========================================================================

CREATE TABLE patient_documents (
  id                uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  patient_id        uuid        NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,

  file_url          text        NOT NULL,
  doc_type          text,
  doc_date          date,

  -- Text, not a foreign key. This is a photograph of a prescription from a
  -- clinic that has never heard of this platform, and the doctor who wrote it
  -- has no row here. Forcing a reference would make the feature unusable for
  -- exactly the records it exists to hold.
  doctor_name_text  text,

  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  CONSTRAINT patient_documents_file_url_not_blank CHECK (btrim(file_url) <> ''),
  CONSTRAINT patient_documents_doc_date_not_future
    CHECK (doc_date IS NULL OR doc_date <= (now() AT TIME ZONE 'Asia/Dhaka')::date)
);

CREATE INDEX patient_documents_patient_idx ON patient_documents (patient_id, doc_date DESC);

CREATE TRIGGER trg_patient_documents_touch
  BEFORE UPDATE ON patient_documents
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE patient_documents ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN patient_documents.doctor_name_text IS
  'Free text: the record is from a clinic outside the platform, so no doctors row exists to reference.';

-- ===========================================================================
-- consents — who a patient let look (FR-PAT-64, FR-SEC-03)
-- ===========================================================================

CREATE TABLE consents (
  id            uuid          PRIMARY KEY DEFAULT uuid_generate_v7(),
  patient_id    uuid          NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  hospital_id   uuid          NOT NULL REFERENCES hospitals (id) ON DELETE RESTRICT,

  -- Null scopes the grant to the whole hospital rather than one clinician.
  doctor_id     uuid          REFERENCES doctors (id) ON DELETE CASCADE,

  scope         consent_scope NOT NULL,

  granted_at    timestamptz   NOT NULL DEFAULT now(),
  expires_at    timestamptz,
  revoked_at    timestamptz,

  -- How the patient said yes. A QR scanned at a chamber, a tap in the app, or a
  -- counter clerk recording it — worth distinguishing, because the weakest of
  -- the three is the one an audit will be asked about.
  granted_via   text          NOT NULL,

  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  created_by    uuid          REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at    timestamptz,

  CONSTRAINT consents_granted_via_allowed CHECK (granted_via IN ('qr', 'app', 'counter')),
  CONSTRAINT consents_window_ordered CHECK (expires_at IS NULL OR expires_at > granted_at),
  CONSTRAINT consents_revoked_after_granted CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

-- The question every record read asks: is there a live grant for this patient
-- to this hospital right now (`FR-DOC-10`).
CREATE INDEX consents_live_idx
  ON consents (patient_id, hospital_id, scope)
  WHERE revoked_at IS NULL AND deleted_at IS NULL;

CREATE INDEX consents_doctor_idx ON consents (doctor_id) WHERE doctor_id IS NOT NULL;

CREATE TRIGGER trg_consents_touch
  BEFORE UPDATE ON consents
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE consents IS
  'A patient letting somebody look. Revocation is a timestamp, never a delete, so an audit can answer what was permitted at the time of a read (DB-P2).';

-- ===========================================================================
-- feedback — the patient's verdict (FR-PAT-83)
-- ===========================================================================
--
-- DATABASE.md §2.7 lists this table in 0010, and 0010 explains why it is not
-- there: its second column is a foreign key to `visits`, which is this file.
-- Writing it earlier would have meant dropping the key and letting a rating
-- attach to a consultation that never happened. It lands here, beside the visit
-- it rates.
--
-- The four scores are the four things `FR-PAT-83` asks about, and *billing
-- honesty* is the one that makes this table worth having: a hospital that
-- quietly charges more than it quoted is the complaint a patient has no other
-- way to make.

CREATE TABLE feedback (
  id                 uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),

  -- One verdict per visit. A patient may change their mind, which is an update
  -- of their row rather than a second opinion counted twice.
  visit_id           uuid        NOT NULL UNIQUE REFERENCES visits (id) ON DELETE RESTRICT,
  patient_id         uuid        NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  hospital_id        uuid        NOT NULL REFERENCES hospitals (id) ON DELETE RESTRICT,

  -- Each is nullable: a patient answering two of four questions has still said
  -- something, and forcing all four is how a feedback form stops being filled in.
  wait_score         smallint,
  doctor_score       smallint,
  cleanliness_score  smallint,
  billing_score      smallint,

  comment            text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,

  CONSTRAINT feedback_scores_in_range CHECK (
    (wait_score        IS NULL OR wait_score        BETWEEN 1 AND 5)
    AND (doctor_score      IS NULL OR doctor_score      BETWEEN 1 AND 5)
    AND (cleanliness_score IS NULL OR cleanliness_score BETWEEN 1 AND 5)
    AND (billing_score     IS NULL OR billing_score     BETWEEN 1 AND 5)
  ),

  -- A row with no score and no comment is a form somebody opened and closed.
  CONSTRAINT feedback_says_something CHECK (
    num_nonnulls(wait_score, doctor_score, cleanliness_score, billing_score) >= 1
    OR btrim(coalesce(comment, '')) <> ''
  )
);

-- `FR-PAT-83`: routed to hospital admin, and aggregated publicly only above a
-- volume threshold — so the aggregate is always read per hospital.
CREATE INDEX feedback_hospital_idx ON feedback (hospital_id, created_at DESC);
CREATE INDEX feedback_patient_idx ON feedback (patient_id, created_at DESC);

CREATE TRIGGER trg_feedback_touch
  BEFORE UPDATE ON feedback
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE feedback IS
  'FR-PAT-83. Billing honesty is the score that matters most: a hospital charging more than it quoted is a complaint a patient has no other route for.';
