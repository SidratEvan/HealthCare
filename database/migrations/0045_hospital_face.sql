-- 0045_hospital_face.sql
--
-- A hospital's public face is its own to set (`PRD.md` `FR-BRD-06`,
-- DATABASE.md §2.2; plan C1).
--
-- 0036 gave a hospital its colours and said "nothing here is a logo". This is
-- the rest of what a patient sees of a hospital that the hospital itself
-- chooses: a short description in both languages, and a logo.
--
-- ## Why the logo is a row and not a file
--
-- Every other file in the product is a clinical document behind a signed,
-- expiring address (`adapters/storage.ts`). A logo is the opposite: public,
-- small, the same for everybody, and shown on every card a hospital appears
-- on. Kept as a row it is there after a restart whatever store the deployment
-- uses (the demonstration's store is this process's memory), it is in the
-- same backup as the hospital it belongs to, the seed can write one, and
-- serving it is one read by primary key. A quarter of a megabyte is the
-- ceiling, which is generous for a mark shown at 48 pixels.
--
-- Its own table, so that reading a hospital's settings never carries an
-- image along.
--
-- Additive: two nullable columns and a new table.

ALTER TABLE hospitals
  ADD COLUMN description_bn text,
  ADD COLUMN description_en text;

ALTER TABLE hospitals
  ADD CONSTRAINT hospitals_description_length CHECK (
    (description_bn IS NULL OR char_length(description_bn) BETWEEN 1 AND 400)
    AND (description_en IS NULL OR char_length(description_en) BETWEEN 1 AND 400)
  );

COMMENT ON COLUMN hospitals.description_bn IS
  'A short description the hospital wrote for patients, in Bangla (FR-BRD-06). NULL: none.';
COMMENT ON COLUMN hospitals.description_en IS
  'The same in English (FR-BRD-06). NULL: none.';

CREATE TABLE hospital_logos (
  hospital_id   uuid        PRIMARY KEY REFERENCES hospitals (id) ON DELETE CASCADE,
  content_type  text        NOT NULL,
  bytes         bytea       NOT NULL,
  -- Of the bytes: the version in the address, so a changed logo is a new
  -- address and an unchanged one may be kept by a phone for a year.
  sha256        text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- SET NULL: who set it is on the audit row as well.
  created_by    uuid        REFERENCES staff_users (id) ON DELETE SET NULL,

  -- No SVG: an image that can carry a script is not one to serve from the
  -- API's own address.
  CONSTRAINT hospital_logos_type_known
    CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  CONSTRAINT hospital_logos_size CHECK (octet_length(bytes) BETWEEN 1 AND 262144),
  CONSTRAINT hospital_logos_sha256_shape CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TRIGGER trg_hospital_logos_touch
  BEFORE UPDATE ON hospital_logos
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE hospital_logos ENABLE ROW LEVEL SECURITY;

-- What a hospital publishes (`FR-NET-01`, 0043): anybody reads, only it
-- changes. Read by a patient and a link too (0044's `app_any`).
CREATE POLICY tenant_read ON hospital_logos FOR SELECT TO app_tenant USING (app_any());
CREATE POLICY tenant_insert ON hospital_logos FOR INSERT TO app_tenant
  WITH CHECK (app_org(hospital_id));
CREATE POLICY tenant_update ON hospital_logos FOR UPDATE TO app_tenant
  USING (app_org(hospital_id)) WITH CHECK (app_org(hospital_id));
CREATE POLICY tenant_delete ON hospital_logos FOR DELETE TO app_tenant
  USING (app_org(hospital_id));

COMMENT ON TABLE hospital_logos IS
  'A hospital''s logo, public, at most 256 KB (FR-BRD-06). One row per hospital; absent means none.';
