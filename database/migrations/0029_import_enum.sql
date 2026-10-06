-- 0029_import_enum.sql
--
-- An appointment brought in from a hospital's own system (pilot step 24,
-- set C, `FR-IMP-01`, `FR-IMP-02`) is a booking like any other, and says where
-- it came from: `booking_source = 'import'`.
--
-- ## Why this file holds one statement
--
-- As in 0021: every migration runs in its own transaction, and PostgreSQL will
-- not let a transaction use an enum value it added itself. Nothing below this
-- line could name 'import'; 0030 and 0031 run after this has committed.

ALTER TYPE booking_source ADD VALUE IF NOT EXISTS 'import';
