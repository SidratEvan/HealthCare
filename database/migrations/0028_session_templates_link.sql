-- 0028_session_templates_link.sql
--
-- Each day's chambers come from the weekly schedule (pilot step 22,
-- DATABASE.md §2.3 `session_templates`: "A nightly job materialises sessions
-- from templates"). Until now the seeds wrote both and nothing joined them, so
-- a job could not tell whether Tuesday's chamber for a schedule already
-- existed — and would write it again.
--
-- sessions.template_id — the schedule a session was made from. Null for a
--   session nobody's schedule made: a one-off chamber, the seeds' history, a
--   test fixture.
--
-- One session per schedule per day. The job inserts with
-- ON CONFLICT DO NOTHING against this index, so running it twice, or after a
-- missed night, or at the same moment from two processes, writes each chamber
-- once. A deleted session frees the day, which is how removing a schedule
-- and adding it back works.

ALTER TABLE sessions
  ADD COLUMN template_id uuid REFERENCES session_templates (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX sessions_template_date_key
  ON sessions (template_id, session_date)
  WHERE template_id IS NOT NULL AND deleted_at IS NULL;
