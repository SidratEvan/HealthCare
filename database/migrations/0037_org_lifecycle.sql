-- 0037_org_lifecycle.sql
--
-- A hospital's workspace has a state, and only an approved one can be live
-- (`PRD.md` §14c `FR-ONB-02`, `FR-ONB-04`, `FR-NET-03`; DATABASE.md §2.2).
--
-- Until now a hospital administrator's own tap published the hospital: one
-- department and one doctor, and it was in front of patients with nobody
-- outside the hospital having looked at it. On a platform several hospitals
-- share, that is a way for anything to list itself as a hospital. So going
-- live becomes two acts by two people: the hospital asks, the platform
-- approves.
--
--   setup ──request──▶ ready_for_review ──approve──▶ active ──▶ closed
--     ▲                      │ send back (note)         │  ▲
--     └──────────────────────┘                  suspend ▼  │ reinstate
--                                                    suspended ──▶ closed
--
-- The transitions are `shared/domain/src/org/lifecycle.ts`. What the database
-- holds is the one rule no route may forget: `is_live`, which every public
-- query already reads, cannot be true unless the workspace is `active`.
--
-- Hospitals that are live today are backfilled to `active`: they were
-- published under the old rule and stay published. Everything else starts in
-- `setup`.
--
-- Additive apart from that backfill. No row is removed.

CREATE TYPE org_lifecycle AS ENUM (
  'setup',
  'ready_for_review',
  'active',
  'suspended',
  'closed'
);

ALTER TABLE hospitals
  ADD COLUMN lifecycle            org_lifecycle NOT NULL DEFAULT 'setup',
  -- The licence or registration number, as the hospital gave it. Free text:
  -- DGHS licences, trade licences and society registrations do not share a
  -- shape, and a CHECK that guessed one would refuse real ones.
  ADD COLUMN registration_no      text,
  ADD COLUMN review_requested_at  timestamptz,
  ADD COLUMN reviewed_at          timestamptz,
  ADD COLUMN reviewed_by          uuid REFERENCES staff_users (id) ON DELETE SET NULL,
  -- Why it was sent back or suspended. Shown to the hospital's administrator,
  -- so it is written for them.
  ADD COLUMN review_note          text;

UPDATE hospitals SET lifecycle = 'active' WHERE is_live;

-- Named so that it is checked after `hospitals_live_requires_onboarding`
-- (CHECKs run in name order): a row that breaks both is still told about
-- onboarding first, which is the older rule and the one callers know.
ALTER TABLE hospitals
  ADD CONSTRAINT hospitals_live_requires_workspace_active
    CHECK (NOT is_live OR lifecycle = 'active');

-- The platform's review list reads the ones waiting, oldest first.
CREATE INDEX hospitals_lifecycle_idx
  ON hospitals (lifecycle, review_requested_at)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN hospitals.lifecycle IS
  'The workspace''s state (FR-ONB-02). Only ''active'' may be live; see hospitals_live_requires_workspace_active.';
COMMENT ON COLUMN hospitals.review_note IS
  'Why the platform sent the workspace back or suspended it. Read by the hospital''s administrator.';
