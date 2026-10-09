-- 0062_chamber_organisations.sql
--
-- An approved private chamber as an organisation (plan R7; `PRD.md`
-- `FR-ONB-11`; the owner's decision 7 of 8 October).
--
-- Registered hospitals, clinics and diagnostic centres join the platform as
-- organisations already. A doctor's private chamber may too, but only once
-- the platform has approved it: there is no open self-registration for an
-- unregistered chamber. So `chamber` is a kind a platform administrator can
-- give a workspace (`POST /platform/hospitals`) and never one the public
-- application form offers (`POST /hospital-applications`).
--
-- Additive: one enum value. Nothing uses it in this migration, so adding it
-- inside the migration's transaction is safe.

ALTER TYPE facility_kind ADD VALUE IF NOT EXISTS 'chamber';
