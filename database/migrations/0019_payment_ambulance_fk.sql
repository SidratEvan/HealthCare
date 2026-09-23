-- 0019_payment_ambulance_fk.sql
--
-- The one foreign key `0009_money.sql` could not make.
--
-- `payments.ambulance_request_id` points at `ambulance_requests`, which is
-- created by `0011_ancillary.sql`. On a fresh database the runner applies
-- migrations in filename order, so 0009 runs *before* 0011 and the reference
-- would be to a table that does not exist yet — which fails the whole
-- migration and, with it, every test database build.
--
-- That is how this was found: the local development database already had
-- 0011 applied, so 0009 succeeded there and only a build from scratch showed
-- it. Worth remembering the next time a migration is numbered backwards into
-- the sequence — a green `db:migrate` on a database that is already ahead
-- proves nothing about a fresh one.
--
-- Numbered 0019 rather than folded into 0009 because a shipped migration is
-- never edited, and past 0014/0015 for the reason 0016, 0017 and 0018 are:
-- those two keep the numbers DATABASE.md §7 gives them and land later.

ALTER TABLE payments
  ADD CONSTRAINT payments_ambulance_request_id_fkey
  FOREIGN KEY (ambulance_request_id)
  REFERENCES ambulance_requests (id) ON DELETE RESTRICT;

COMMENT ON COLUMN payments.ambulance_request_id IS
  'Nothing charges for an ambulance in this version — S-A-16 is a later step, '
  'and a fare is a commercial term per operator (CLAUDE.md §1.1). The column '
  'and its key exist because DATABASE.md §2.6 specifies them.';
