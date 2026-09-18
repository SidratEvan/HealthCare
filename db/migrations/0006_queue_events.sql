-- 0006_queue_events.sql
--
-- The event log the entire product is derived from, and the derived cache that
-- makes reading it cheap.
--
-- DATABASE.md §2.3, DB-P1: `queue_events` is append-only and is the only
-- writable truth about a session. `queue_state` is a cache and may be rebuilt
-- from events at any time (FR-QUE-02, FR-QUE-05).
--
-- Replaying the log for a session reproduces its exact state. That is not an
-- architectural preference — it is the dispute-resolution mechanism. When a
-- patient says "I was here at five and you skipped me", the log answers, and
-- it answers the same way every time it is asked.
--
-- No queue logic lives in this file. The reducer exists once, in
-- packages/domain, and both the API and the console import it unchanged
-- (BACKEND.md §0). Anything here that looks like a decision is a constraint
-- on what may be recorded, never on what it means.

-- ===========================================================================
-- queue_events — append-only (DB-P1)
-- ===========================================================================

CREATE TABLE queue_events (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),

  -- DATABASE.md §2.3 specifies a bigserial, unique per session via
  -- (session_id, seq). The sequence is global, so seq is monotonic within a
  -- session but not contiguous. Every consumer — the realtime resume
  -- handshake, the offline delta pull, the replay — needs ordering, not
  -- density (SY-01).
  seq                  bigserial        NOT NULL,

  session_id           uuid             NOT NULL REFERENCES sessions (id) ON DELETE RESTRICT,
  type                 queue_event_type NOT NULL,
  booking_id           uuid             REFERENCES bookings (id) ON DELETE RESTRICT,

  -- Who did it (FR-QUE-04). Staff for console actions, user for the patient's
  -- own PATIENT_LATE or BOOKING_CANCELLED, neither for system events such as
  -- an automatic no-show sweep or a slot offer expiring.
  actor_staff_id       uuid             REFERENCES staff_users (id) ON DELETE SET NULL,
  actor_user_id        uuid             REFERENCES users (id) ON DELETE SET NULL,
  actor_role           staff_role,

  -- Type-specific, shapes fixed by DATABASE.md §3 and validated by the zod
  -- schemas in packages/domain, which the API and the console both import.
  payload              jsonb            NOT NULL DEFAULT '{}'::jsonb,

  -- From the console. May be hours old after an offline shift, and orders a
  -- replayed batch within itself only (SY-01).
  client_ts            timestamptz,

  -- Authoritative. The server clock decides order, always (FR-QUE-51).
  server_ts            timestamptz      NOT NULL DEFAULT now(),

  -- Idempotency for offline replay: a batch resent after a dropped connection
  -- must not advance the queue twice (FR-QUE-51, SY-02).
  client_event_id      uuid,

  -- Set when a later ACTION_UNDONE compensates this event (GR-02).
  undone_by_event_id   uuid             REFERENCES queue_events (id) ON DELETE SET NULL,

  created_at           timestamptz      NOT NULL DEFAULT now(),
  updated_at           timestamptz      NOT NULL DEFAULT now(),

  CONSTRAINT queue_events_payload_is_object CHECK (jsonb_typeof(payload) = 'object'),

  -- An event is recorded by a staff member, by a patient, or by the system.
  -- Both actors set at once means the writer did not know who acted, and an
  -- unattributable queue action is exactly what the audit log exists to
  -- prevent (FR-QUE-04, FR-SEC-03).
  CONSTRAINT queue_events_single_actor
    CHECK (num_nonnulls(actor_staff_id, actor_user_id) <= 1),

  -- A staff role is meaningful only alongside a staff actor.
  CONSTRAINT queue_events_role_requires_staff
    CHECK (actor_role IS NULL OR actor_staff_id IS NOT NULL),

  -- Events that are about one patient must say which (DATABASE.md §3).
  CONSTRAINT queue_events_patient_events_have_booking
    CHECK (
      type NOT IN (
        'PATIENT_CALLED', 'PATIENT_DONE', 'PATIENT_LATE', 'PATIENT_NO_SHOW',
        'PATIENT_REINSERTED', 'WALKIN_ADDED', 'BOOKING_CANCELLED', 'PRIORITY_REORDERED'
      )
      OR booking_id IS NOT NULL
    ),

  -- An undo must name what it undid.
  CONSTRAINT queue_events_undo_names_target
    CHECK (type <> 'ACTION_UNDONE' OR payload ? 'undoneEventId'),

  CONSTRAINT queue_events_not_self_undone
    CHECK (undone_by_event_id IS NULL OR undone_by_event_id <> id)
);

-- DATABASE.md §2.3: seq is unique per session.
CREATE UNIQUE INDEX queue_events_session_seq_key ON queue_events (session_id, seq);

-- The hot path (DATABASE.md §6). Covering, so a replay or a delta pull reads
-- the index and the heap in session order without a sort.
CREATE INDEX queue_events_session_seq_idx ON queue_events (session_id, seq)
  INCLUDE (type, booking_id, payload, server_ts);

CREATE INDEX queue_events_session_server_ts_idx ON queue_events (session_id, server_ts);

-- Idempotency lookup, and the reason a replayed offline batch is safe.
-- Partial because system-generated events carry no client_event_id.
CREATE UNIQUE INDEX queue_events_client_event_id_key
  ON queue_events (client_event_id) WHERE client_event_id IS NOT NULL;

CREATE INDEX queue_events_booking_idx
  ON queue_events (booking_id) WHERE booking_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Append-only enforcement (DB-P1)
--
-- DELETE is refused outright. UPDATE is refused except for one transition:
-- setting `undone_by_event_id` on a row where it is still null, changing
-- nothing else. That exception exists because DATABASE.md §2.3 defines the
-- column as "set when compensated", which is by definition later than the
-- insert — without it the column could never be written and would be dead.
--
-- The recorded fact itself stays immutable: type, payload, actor, timestamps
-- and seq can never change after insert. History is never rewritten and never
-- deleted (GR-02: undo appends a compensating event, it does not erase).
--
-- Enforced by trigger *and* by RLS (DATABASE.md §2.3), so a mistake in one
-- layer is not the only thing standing between a dispute and a rewritten log.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_queue_events_no_mutate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'queue_events is append-only: DELETE is not permitted (DB-P1, FR-QUE-02)'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- The only permitted mutation: a null undone_by_event_id becoming set.
  IF OLD.undone_by_event_id IS NOT NULL OR NEW.undone_by_event_id IS NULL THEN
    RAISE EXCEPTION
      'queue_events is append-only: UPDATE is not permitted (DB-P1, FR-QUE-02). Undo appends ACTION_UNDONE (GR-02)'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- …and nothing else may move with it.
  IF ROW (
       NEW.id, NEW.seq, NEW.session_id, NEW.type, NEW.booking_id,
       NEW.actor_staff_id, NEW.actor_user_id, NEW.actor_role, NEW.payload,
       NEW.client_ts, NEW.server_ts, NEW.client_event_id, NEW.created_at
     ) IS DISTINCT FROM ROW (
       OLD.id, OLD.seq, OLD.session_id, OLD.type, OLD.booking_id,
       OLD.actor_staff_id, OLD.actor_user_id, OLD.actor_role, OLD.payload,
       OLD.client_ts, OLD.server_ts, OLD.client_event_id, OLD.created_at
     )
  THEN
    RAISE EXCEPTION
      'queue_events is append-only: only undone_by_event_id may be set after insert (DB-P1)'
      USING ERRCODE = 'restrict_violation';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_queue_events_no_mutate
  BEFORE UPDATE OR DELETE ON queue_events
  FOR EACH ROW EXECUTE FUNCTION fn_queue_events_no_mutate();

-- TRUNCATE bypasses row triggers entirely, so it gets its own statement-level
-- guard. `pnpm db:reset` rebuilds the demo database by dropping the schema,
-- not by truncating the log (DATABASE.md §7).
CREATE OR REPLACE FUNCTION fn_queue_events_no_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'queue_events is append-only: TRUNCATE is not permitted (DB-P1). Drop and rebuild the schema instead'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER trg_queue_events_no_truncate
  BEFORE TRUNCATE ON queue_events
  FOR EACH STATEMENT EXECUTE FUNCTION fn_queue_events_no_truncate();

ALTER TABLE queue_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE queue_events IS
  'Append-only log of every fact about a session (DB-P1). The queue is derived from this and nothing else. Retention >= 2 years (NFR-09).';
COMMENT ON COLUMN queue_events.seq IS
  'Authoritative ordering within a session. Clients resume from a seq (SY-01).';
COMMENT ON COLUMN queue_events.client_ts IS
  'Console clock, possibly hours stale after an offline shift. Orders a batch within itself only.';
COMMENT ON COLUMN queue_events.client_event_id IS
  'Idempotency key for offline replay (FR-QUE-51). A repeated batch returns the stored result.';

-- ===========================================================================
-- queue_state — derived cache
--
-- Read for display so a page load does not replay the log (DATABASE.md §6).
-- Rebuildable at any time by fn_rebuild_queue_state (0013); `rebuilt_from_seq`
-- records how far the cache has consumed, and a value behind
-- sessions.last_event_seq means it needs rebuilding before it is trusted.
-- ===========================================================================

CREATE TABLE queue_state (
  session_id             uuid PRIMARY KEY REFERENCES sessions (id) ON DELETE CASCADE,
  now_serving_booking_id uuid        REFERENCES bookings (id) ON DELETE SET NULL,
  now_serving_serial     integer,
  waiting_count          integer     NOT NULL DEFAULT 0,
  late_count             integer     NOT NULL DEFAULT 0,
  no_show_count          integer     NOT NULL DEFAULT 0,
  done_count             integer     NOT NULL DEFAULT 0,
  avg_consult_seconds    integer,
  projected_end          timestamptz,
  rebuilt_from_seq       bigint      NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT queue_state_counts_non_negative
    CHECK (waiting_count >= 0 AND late_count >= 0
       AND no_show_count >= 0 AND done_count >= 0),
  CONSTRAINT queue_state_serial_positive
    CHECK (now_serving_serial IS NULL OR now_serving_serial > 0),
  CONSTRAINT queue_state_rebuilt_from_seq_non_negative CHECK (rebuilt_from_seq >= 0),
  CONSTRAINT queue_state_avg_consult_plausible
    CHECK (avg_consult_seconds IS NULL OR avg_consult_seconds BETWEEN 1 AND 10800),

  -- FR-QUE-53: only one patient is "now serving" at a time, and either both
  -- halves of that fact are known or neither is.
  CONSTRAINT queue_state_now_serving_consistent
    CHECK (num_nonnulls(now_serving_booking_id, now_serving_serial) <> 1)
);

CREATE TRIGGER trg_queue_state_touch
  BEFORE UPDATE ON queue_state
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE queue_state ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE queue_state IS
  'Derived cache, never a source of truth (DB-P1). Safe to delete: fn_rebuild_queue_state reconstructs it from queue_events.';
COMMENT ON COLUMN queue_state.rebuilt_from_seq IS
  'How far this cache has consumed the log. Behind sessions.last_event_seq means rebuild before trusting.';
COMMENT ON COLUMN queue_state.updated_at IS
  'Drives the freshness line every patient sees (FR-PAT-35, FR-OFF-03).';

-- ===========================================================================
-- standby_list — who gets offered a freed slot, in order (FR-PAT-25)
-- ===========================================================================

CREATE TABLE standby_list (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  session_id     uuid        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  patient_id     uuid        NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  contact_phone  text        NOT NULL,
  position       integer     NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  removed_at     timestamptz,

  CONSTRAINT standby_list_position_positive CHECK (position > 0),
  CONSTRAINT standby_list_phone_normalised
    CHECK (contact_phone ~ '^\+8801[3-9][0-9]{8}$')
);

-- Offers go out in order, so two people cannot hold the same place in it.
CREATE UNIQUE INDEX standby_list_session_position_key
  ON standby_list (session_id, position) WHERE removed_at IS NULL;

CREATE UNIQUE INDEX standby_list_session_patient_key
  ON standby_list (session_id, patient_id) WHERE removed_at IS NULL;

CREATE TRIGGER trg_standby_list_touch
  BEFORE UPDATE ON standby_list
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE standby_list ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- slot_offers — a freed slot, offered with a deadline (FR-QUE-30)
--
-- `recovered_value_poisha` is the taka figure a hospital director is shown on
-- the admin dashboard (FR-QUE-31, FR-ADM-03). It is the number that makes the
-- no-show problem visible as money, which is the argument that sells this
-- product, so it is recorded on the offer rather than recomputed later from a
-- fee that may since have changed.
-- ===========================================================================

CREATE TABLE slot_offers (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  session_id              uuid        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  freed_booking_id        uuid        REFERENCES bookings (id) ON DELETE SET NULL,
  offered_to_patient_id   uuid        NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  offered_at              timestamptz NOT NULL DEFAULT now(),
  expires_at              timestamptz NOT NULL,
  accepted_at             timestamptz,
  declined_at             timestamptz,
  recovered_value_poisha  integer,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT slot_offers_window_ordered CHECK (expires_at > offered_at),

  -- An offer is accepted or declined, never both.
  CONSTRAINT slot_offers_single_outcome
    CHECK (num_nonnulls(accepted_at, declined_at) <= 1),

  CONSTRAINT slot_offers_recovered_value_non_negative
    CHECK (recovered_value_poisha IS NULL OR recovered_value_poisha >= 0),

  -- Value is recovered only when someone actually takes the slot.
  CONSTRAINT slot_offers_value_requires_acceptance
    CHECK (recovered_value_poisha IS NULL OR accepted_at IS NOT NULL)
);

-- The expiry worker runs every 30 seconds (BACKEND.md §8) and asks only for
-- offers still outstanding.
CREATE INDEX slot_offers_pending_idx
  ON slot_offers (expires_at)
  WHERE accepted_at IS NULL AND declined_at IS NULL;

CREATE INDEX slot_offers_session_idx ON slot_offers (session_id, offered_at);
CREATE INDEX slot_offers_patient_idx ON slot_offers (offered_to_patient_id);

CREATE TRIGGER trg_slot_offers_touch
  BEFORE UPDATE ON slot_offers
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE slot_offers ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN slot_offers.recovered_value_poisha IS
  'Integer poisha recovered by this acceptance (FR-QUE-31). Recorded at acceptance, not recomputed.';
