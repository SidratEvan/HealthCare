-- 0036_hospital_brand.sql
--
-- A hospital's own colours for the patient app (`PRD.md` `FR-BRD-03`,
-- DATABASE.md §2.2).
--
-- The patient app is drawn from tokens only, and the brand is six of them. A
-- hospital-branded app is the same app with those six values replaced, read
-- from the server at start (`GET /config?scope=<code>`). This column is where
-- they are kept. The shape and the contrast rules a theme must pass are in
-- `shared/domain/src/brand/theme.ts`; the database holds only that it is an
-- object, as it does for `refund_policy`, because a CHECK that knew the token
-- names would have to change every time the design system gained one.
--
-- NULL is the ordinary state: the hospital appears in the platform's own
-- colours. Nothing here is a logo, a font or a domain (`FR-BRD-05`).
--
-- Additive: no row changes, nothing is rewritten.

ALTER TABLE hospital_settings
  ADD COLUMN brand jsonb;

ALTER TABLE hospital_settings
  ADD CONSTRAINT hospital_settings_brand_is_object
    CHECK (brand IS NULL OR jsonb_typeof(brand) = 'object');

COMMENT ON COLUMN hospital_settings.brand IS
  'The brand tokens a hospital-branded patient app uses instead of the platform''s (FR-BRD-03). NULL: the platform''s own.';
