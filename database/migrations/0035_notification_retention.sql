-- 0035_notification_retention.sql
--
-- What a message leaves behind (`docs/PLATFORM_PLAN.md` 1.9; `docs/HANDOVER.md`
-- §12 item 13; DATABASE.md §2.7, §8).
--
-- A tracking link opens one booking's live queue, its signed record and its
-- reports (`FR-GST-05`), and this database is meant to hold only its hash
-- (`guest_links.token_hash`). Until now the link itself was stored in every
-- confirmation's row, twice: as `params.link`, and inside the rendered text in
-- `params.body`. Beside it the hash protected nothing from anybody who could
-- read this table, a dump of it, or a backup. The same was true of a standby
-- place's link, a bed request's and an emergency alert's.
--
-- The API stops writing one in the same step (`notification.service`
-- `forTheRecord`). This file is the part the API cannot do by itself: clean
-- what is already there, make PostgreSQL refuse the next one, and let the
-- ninety-day purge find its rows.

SET LOCAL search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. The links already stored.
--
-- The text keeps its words and gets the template's own placeholder back where
-- the link was, which is exactly what the API writes from now on — so a row
-- from before this migration and a row from after it read the same way.
-- ---------------------------------------------------------------------------

UPDATE notifications
   SET params = (params - 'link')
                || CASE
                     WHEN params ? 'body' AND params ->> 'link' <> ''
                       THEN jsonb_build_object(
                              'body',
                              replace(params ->> 'body', params ->> 'link', '{link}')
                            )
                     ELSE '{}'::jsonb
                   END
 WHERE params ? 'link';

-- ---------------------------------------------------------------------------
-- 2. And none after it.
--
-- The rule lives in one function in the API. A rule that depends on every
-- future caller going through that function is a convention; this makes it
-- something the database holds. The key is refused even when empty, so it
-- cannot come back as a harmless-looking blank and be filled in later.
--
-- It cannot see a link pasted into the text under another name. Nothing can,
-- short of refusing every address in every message, and a template may one
-- day carry a public one. That half stays with the API and its tests.
-- ---------------------------------------------------------------------------

ALTER TABLE notifications
  ADD CONSTRAINT notifications_no_stored_link
  CHECK (NOT (params ? 'link'));

COMMENT ON CONSTRAINT notifications_no_stored_link ON notifications IS
  'A tracking or status link is a credential (FR-GST-05): it is sent, never stored. Only its hash is kept, in guest_links.';

-- ---------------------------------------------------------------------------
-- 3. The rows whose words are due to be cleared (DATABASE.md §8: bodies kept
--    90 days, metadata kept).
--
-- Partial on purpose. A cleared row loses its `body` and leaves this index, so
-- the hourly purge reads only what it still has to do: a table of ten million
-- old messages costs it nothing once they have been cleared.
-- ---------------------------------------------------------------------------

CREATE INDEX notifications_body_kept_idx
  ON notifications (queued_at)
  WHERE params ? 'body';
