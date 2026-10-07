-- 0055_backup_runs.sql
--
-- What the nightly backup last did, where the API can read it (plan I2;
-- `PRD.md` `FR-SUP-06`: "the age of the last backup is the deployment's and
-- not one hospital's; it belongs to the health endpoints"; DATABASE.md §2.7).
--
-- The backup container (`deploy/backup.sh`) already writes the result of
-- every run to a file on its own volume, which its health check reads. The
-- API runs in another container and cannot see that file, so a server whose
-- backups had been failing for a week answered `/readyz` as if nothing were
-- wrong. The script now also appends one row here per run, as the database's
-- owner, and `/readyz` reads the newest.
--
-- Written by the owner only. The API's role may read it and nothing more
-- (`database/scripts/lib/role.ts`), so an API that has been made to misbehave
-- cannot record a backup that never happened. Read only in the server's own
-- `system` scope: a hospital, a patient and the platform's screens have no
-- business with it.
--
-- Nothing in a row identifies anybody: when, whether it worked, how it was
-- checked, and the script's own sentence when it did not.
--
-- Additive: one table, its index and its policy.

CREATE TABLE backup_runs (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  finished_at  timestamptz NOT NULL DEFAULT now(),
  result       text NOT NULL CHECK (result IN ('ok', 'failed')),
  -- `restore`: the dump was restored into a scratch database and counted;
  -- `list`: only its table of contents was read (BACKUP_VERIFY_RESTORE=false).
  verified     text CHECK (verified IN ('restore', 'list')),
  -- The run's own name for itself, `db-<stamp>.dump` without the rest.
  stamp        text NOT NULL CHECK (length(stamp) <= 32),
  reason       text CHECK (length(reason) <= 300),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((result = 'ok') = (reason IS NULL))
);

-- Nothing updates a run; the rule is every table's (DB-P3).
CREATE TRIGGER trg_backup_runs_touch
  BEFORE UPDATE ON backup_runs
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

CREATE INDEX backup_runs_finished_idx ON backup_runs (finished_at DESC);

ALTER TABLE backup_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_read ON backup_runs FOR SELECT TO app_tenant
  USING (coalesce(app_scope() = 'system', false));
