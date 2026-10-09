-- 0047_hospital_modules.sql
--
-- The modules a hospital runs (`PRD.md` `FR-BRD-11`, `FR-SUP-03`;
-- DATABASE.md §2.2; plan C4).
--
-- One platform, and not every hospital uses all of it. A module that is off
-- for a hospital is not offered on its consoles, is refused by the API, and
-- is absent from what the hospital publishes. Nothing it holds is deleted.
--
-- ## Stored as what is off
--
-- `modules_off`, empty by default. Every hospital that exists has everything
-- on with nothing written, every hospital made later starts the same way,
-- and a module the product gains later is on for everybody without a
-- migration to say so. The names are held to the list the product has
-- (`HOSPITAL_MODULES` in `shared/domain`), so a misspelt module cannot be
-- "off" for ever while the real one stays on.
--
-- ## One function for "is it on"
--
-- `fn_module_on(hospital, module)`. What a hospital publishes is read by many
-- queries: the hospital list, the session list, the bed capacity, the
-- emergency search, the medicine search. Each asks this, so there is one
-- definition of "on" and a query cannot spell it differently. A hospital with
-- no settings row has nothing off.
--
-- Additive: one column with a default, one function.

ALTER TABLE hospital_settings
  ADD COLUMN modules_off text[] NOT NULL DEFAULT '{}';

ALTER TABLE hospital_settings
  ADD CONSTRAINT hospital_settings_modules_known CHECK (
    modules_off <@ ARRAY[
      'queue', 'doctor', 'beds', 'emergency', 'lab', 'pharmacy', 'dashboard', 'import'
    ]::text[]
  );

-- The doctor's console works a chamber's queue: it is never on where serials
-- are off (`modulesProblems` in `shared/domain`).
ALTER TABLE hospital_settings
  ADD CONSTRAINT hospital_settings_doctor_needs_queue CHECK (
    NOT ('queue' = ANY (modules_off)) OR 'doctor' = ANY (modules_off)
  );

COMMENT ON COLUMN hospital_settings.modules_off IS
  'The modules this hospital does not run (FR-BRD-11). Empty: everything is on.';

CREATE FUNCTION fn_module_on(hospital uuid, module text) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM hospital_settings s
     WHERE s.hospital_id = hospital AND module = ANY (s.modules_off))
$$;

COMMENT ON FUNCTION fn_module_on(uuid, text) IS
  'Whether a hospital runs a module (FR-BRD-11). The one definition every published read asks.';
