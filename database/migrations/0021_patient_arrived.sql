-- 0021_patient_arrived.sql
--
-- `PATIENT_ARRIVED`: reception records that a patient is here (`FR-REC-18`).
--
-- Until this event existed nothing in the product recorded a patient
-- arriving, so `FR-ADM-01`'s average wait — arrival to call — had no source,
-- and step 19's dashboard said so (STATUS decision 61). The owner ruled on
-- 2026-09-23: reception checks a patient in, and quotes them a wait.
--
-- ## Why this file holds one statement
--
-- Every migration runs inside its own transaction, and PostgreSQL will not let
-- a transaction use an enum value it added itself. The constraint that names
-- `PATIENT_ARRIVED` and the column the event projects into are therefore in
-- 0022, which runs after this has committed.

ALTER TYPE queue_event_type ADD VALUE IF NOT EXISTS 'PATIENT_ARRIVED' AFTER 'PATIENT_REINSERTED';
