-- 0048_publishing.sql
--
-- A hospital decides which live figures it shares (`PRD.md` `FR-NET-04`;
-- DATABASE.md §2.2; plan C5).
--
-- Until now a hospital in the network published every figure it had. Which
-- of them it shares is its own decision: how many serials are open and who
-- is sitting, its beds by kind, which medicines its pharmacy has. A figure
-- it withholds is said to be not shared, never shown as zero.
--
-- ## Stored as what is withheld
--
-- `unpublished`, empty by default, for the reason `modules_off` is (0047):
-- every hospital that exists shares what it shared yesterday with nothing
-- written, and a figure the product gains later is shared unless a hospital
-- says otherwise.
--
-- ## One function for "does it share this"
--
-- `fn_publishes(hospital, figure)`, asked by every query that reads a figure
-- for the public, beside `fn_module_on`. The two are different questions:
-- a hospital that does not run beds has no bed figure; one that runs beds and
-- withholds the figure is said to withhold it (`notSharedOf` in
-- `shared/domain`).
--
-- What an emergency department can treat is not in the list, and so cannot
-- be withheld (`shared/domain/src/network/publishing.ts`).
--
-- Additive: one column with a default, one function.

ALTER TABLE hospital_settings
  ADD COLUMN unpublished text[] NOT NULL DEFAULT '{}';

ALTER TABLE hospital_settings
  ADD CONSTRAINT hospital_settings_unpublished_known CHECK (
    unpublished <@ ARRAY['serials', 'beds', 'stock']::text[]
  );

COMMENT ON COLUMN hospital_settings.unpublished IS
  'The live figures this hospital does not share with the network (FR-NET-04). Empty: it shares them all.';

CREATE FUNCTION fn_publishes(hospital uuid, figure text) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM hospital_settings s
     WHERE s.hospital_id = hospital AND figure = ANY (s.unpublished))
$$;

COMMENT ON FUNCTION fn_publishes(uuid, text) IS
  'Whether a hospital shares a live figure with the network (FR-NET-04). Asked by every public read of one.';
