-- 0017_referrals.sql
--
-- What `referrals` (0008) could not yet say (DATABASE.md §2.5; `FR-EMG-07..09`).
--
-- 0008 created `referrals` to the letter of DATABASE.md §2.5 before any
-- console sent one. Building the refer-out and refer-in flows (step 16) found
-- four things the table had nowhere to put. Each was put to the owner and
-- ruled on (2026-09-22) before this file was written, and DATABASE.md §2.5 now
-- lists the columns:
--
--   required_capability  A referral asks another ER for what this one cannot
--   → nullable,          give. That is sometimes a capability (a burn unit) and
--   required_bed_kind    often a bed (an ICU bed, when this ICU is full) — and
--                        four of `FR-PAT-42`'s eight problems map to no
--                        capability at all. NOT NULL made "we have no free ICU
--                        bed" impossible to send. A referral now asks for a
--                        capability, a kind of bed, or both; never neither.
--
--   arrived_case_id      The case the receiving ER opened when the person
--                        walked in. `emergency_case_id` is the sending ER's
--                        case; arrival gives the receiving ER one of its own —
--                        a token called aloud, a place on its triage list —
--                        and the referral is what joins the two.
--
--   responded_by         Who at the receiving ER said yes or no. The sender's
--                        person is `created_by`.
--
--   idempotency_key      CLAUDE.md §7, and the ER console is offline-capable
--                        (`FR-OFF-01`): a referral sent from a console that lost
--                        its connection is replayed on reconnect, and must find
--                        the referral it already made.
--
-- `closed_at` is added alongside them, as 0016 added it to `emergency_cases`:
-- the moment a referral stopped being something anybody waits on, whatever
-- the reason. It is what "one open referral per case" is keyed on.
--
-- ## Who is responsible, when
--
-- The owner's ruling: the sending ER keeps the case — it stays on its triage
-- list and counts towards its load (`FR-EMG-04`) — until the receiving ER
-- records the arrival. Only then does the sending case close as `referred`.
-- A person in an ambulance between two hospitals is still the sending ER's.
--
-- ## Nothing here names anybody
--
-- `summary` is what the case says — problem, colour, age, sex — and a short
-- note. It is read by a second hospital, so it carries no name and no number.

ALTER TABLE referrals
  ALTER COLUMN required_capability DROP NOT NULL,
  ADD COLUMN required_bed_kind  bed_kind,
  ADD COLUMN arrived_case_id    uuid,
  ADD COLUMN responded_by       uuid REFERENCES staff_users (id) ON DELETE SET NULL,
  ADD COLUMN closed_at          timestamptz,
  ADD COLUMN idempotency_key    text;

-- The target of the two composite keys below: a case, and the hospital it is at.
ALTER TABLE emergency_cases
  ADD CONSTRAINT emergency_cases_id_hospital_key UNIQUE (id, hospital_id);

ALTER TABLE referrals
  -- The case being referred is at the hospital referring it, and the case the
  -- arrival opened is at the hospital receiving it. Without these, a console
  -- bug could refer another hospital's patient, or file an arrival under the
  -- wrong ER — and both would look like a referral.
  ADD CONSTRAINT referrals_case_at_sender
    FOREIGN KEY (emergency_case_id, from_hospital_id)
    REFERENCES emergency_cases (id, hospital_id) ON DELETE RESTRICT,
  ADD CONSTRAINT referrals_arrival_at_receiver
    FOREIGN KEY (arrived_case_id, to_hospital_id)
    REFERENCES emergency_cases (id, hospital_id) ON DELETE RESTRICT,

  -- A referral asks for something.
  ADD CONSTRAINT referrals_asks_for_something
    CHECK (required_capability IS NOT NULL OR required_bed_kind IS NOT NULL),

  -- A reason if and only if declined. 0008 required the first half.
  ADD CONSTRAINT referrals_reason_only_when_declined
    CHECK (decline_reason IS NULL OR state = 'declined'),

  -- Each state carries the stamps of the timeline `FR-EMG-08` records:
  -- sent → seen → accepted → arrived. An answer is always seen first; the
  -- service stamps `seen_at` with the answer if nobody opened the card.
  ADD CONSTRAINT referrals_seen_stamped
    CHECK (state NOT IN ('seen', 'accepted', 'declined', 'arrived') OR seen_at IS NOT NULL),
  ADD CONSTRAINT referrals_answer_stamped
    CHECK (state NOT IN ('accepted', 'declined', 'arrived') OR responded_at IS NOT NULL),
  -- A cancelled referral may have been accepted first (the family took the
  -- person elsewhere), so an answer stamp is allowed on it.
  ADD CONSTRAINT referrals_answer_only_when_answered
    CHECK (responded_at IS NULL OR state IN ('accepted', 'declined', 'arrived', 'cancelled')),

  -- Arrived if and only if the receiving ER opened a case for the person.
  ADD CONSTRAINT referrals_arrival_complete
    CHECK (
      (state = 'arrived') = (arrived_at IS NOT NULL)
      AND (arrived_at IS NULL) = (arrived_case_id IS NULL)
    ),

  -- Open if and only if not closed: sent, seen and accepted are what somebody
  -- is still waiting on.
  ADD CONSTRAINT referrals_closed_when_final
    CHECK ((closed_at IS NULL) = (state IN ('sent', 'seen', 'accepted'))),

  ADD CONSTRAINT referrals_timeline_in_order
    CHECK (
      (seen_at IS NULL OR seen_at >= sent_at)
      AND (responded_at IS NULL OR responded_at >= sent_at)
      AND (arrived_at IS NULL OR (responded_at IS NOT NULL AND arrived_at >= responded_at))
      AND (closed_at IS NULL OR closed_at >= sent_at)
    ),

  -- The same bounds the `Idempotency-Key` middleware enforces.
  ADD CONSTRAINT referrals_idempotency_key_shape
    CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 16 AND 128);

-- A replayed send finds the referral it already made.
CREATE UNIQUE INDEX referrals_idempotency_key
  ON referrals (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- One person is asked about at one hospital at a time. Two ERs both preparing
-- for somebody who can only go to one of them is a bed held for nobody.
CREATE UNIQUE INDEX referrals_one_open_per_case
  ON referrals (emergency_case_id)
  WHERE emergency_case_id IS NOT NULL AND closed_at IS NULL AND deleted_at IS NULL;

-- One arrival, one referral.
CREATE UNIQUE INDEX referrals_arrived_case_key
  ON referrals (arrived_case_id) WHERE arrived_case_id IS NOT NULL;

-- A person referred on had to be here first: `referred` is the case of
-- somebody who arrived, and left for another ER (0016's comment: "after
-- arrival, leaving is a referral").
ALTER TABLE emergency_cases
  ADD CONSTRAINT emergency_cases_referred_after_arrival
    CHECK (state <> 'referred' OR arrived_at IS NOT NULL);

COMMENT ON COLUMN referrals.required_capability IS
  'What the receiving ER must be able to do (FR-EMG-07). Null when the referral asks only for a bed.';
COMMENT ON COLUMN referrals.required_bed_kind IS
  'The kind of free bed the referral asks for — an ICU bed, a burn bed. Null when it asks only for a capability.';
COMMENT ON COLUMN referrals.arrived_case_id IS
  'The case the receiving ER opened when the person arrived. Present if and only if state = arrived.';
COMMENT ON COLUMN referrals.responded_by IS
  'Who at the receiving ER accepted or declined.';
COMMENT ON COLUMN referrals.closed_at IS
  'When the referral stopped being awaited: declined, arrived or cancelled. Null exactly while sent, seen or accepted.';
COMMENT ON COLUMN referrals.idempotency_key IS
  'The console''s clientEventId for the send. Unique: a replayed send finds the referral it made.';
COMMENT ON COLUMN referrals.summary IS
  'What the receiving ER is told: problem, triage colour, age and sex as the case holds them, and a short note. Names nobody.';
