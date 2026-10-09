-- 0046_portal_domain.sql
--
-- A hospital's portal has an address (`PRD.md` `FR-BRD-07`; DATABASE.md §2.2;
-- plan C2).
--
-- The patient app opened at `<code>.<platform domain>` is that hospital's
-- portal, and that needs nothing stored: the code is already the hospital's
-- (`hospitals.code`). What needs storing is the other kind of address, a
-- domain the hospital itself owns (`portal.example-hospital.com.bd`), which a
-- platform administrator records once the hospital has pointed it at the
-- platform. Pointing it, and its certificate, are outside the product;
-- recording it and answering for it are inside.
--
-- One domain a hospital, and no two hospitals the same one: an address is
-- one hospital's portal or nobody's.
--
-- Stored lower-case, as it is compared (`normaliseHost` in `shared/domain`),
-- and the constraint holds it to that so a name typed with a capital cannot
-- become a second, unreachable spelling of the same address.
--
-- Additive: one nullable column.

ALTER TABLE hospitals
  ADD COLUMN portal_domain text;

ALTER TABLE hospitals
  ADD CONSTRAINT hospitals_portal_domain_shape CHECK (
    portal_domain IS NULL
    OR (
      portal_domain = lower(portal_domain)
      AND char_length(portal_domain) <= 253
      AND portal_domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    )
  );

CREATE UNIQUE INDEX hospitals_portal_domain_key
  ON hospitals (portal_domain)
  WHERE portal_domain IS NOT NULL;

COMMENT ON COLUMN hospitals.portal_domain IS
  'A domain the hospital owns, recorded by a platform administrator: the patient app opened there is this hospital''s portal (FR-BRD-07). NULL: none.';
