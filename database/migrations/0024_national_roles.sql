-- 0024_national_roles.sql
--
-- A national role has no home facility (`FR-ROLE-01`, STATUS decision 5).
--
-- "Every role is scoped to a hospital except R1, R2, R10, R11." R10 is
-- `platform_admin` and R11 `gov_viewer`, and 0003 gave both tables a NOT NULL
-- `hospital_id` — so a government viewer could only be written by inventing a
-- facility for them to belong to. The seeds refused to, and step 20 cannot
-- start without one: `gov_viewer` is the only role that reads `S-B-13`.
--
-- ## Nullable, with the null tied to the role
--
-- The roles stay in `staff_roles`, beside every other role, because
-- `FR-ROLE-02` makes holding several the normal case and `staff_role` already
-- lists both. What changes is that the facility may be absent — and only for
-- those two. A receptionist with no hospital would pass every scope check in
-- the API by having nothing to compare, which is the failure `toPrincipal`
-- already refuses at the token; this refuses it in the table as well.
--
-- `staff_users.hospital_id` becomes nullable too, since the account of a
-- person who works for no facility has none. What cannot be checked here is
-- that a null-hospital account holds only national roles: a CHECK sees one
-- row. The API holds that line instead — a token without a hospital becomes a
-- national principal only when every role on it is national, and is refused
-- otherwise (`middleware/auth.ts`).
--
-- ## The unique keys a null would slip through
--
-- `staff_users_hospital_email_key` and `staff_roles_unique` both include
-- `hospital_id`, and PostgreSQL treats two nulls as distinct — so without the
-- two partial indexes below, one person could be given the government role
-- twice, or two national accounts the same email.

ALTER TABLE staff_users ALTER COLUMN hospital_id DROP NOT NULL;
ALTER TABLE staff_roles ALTER COLUMN hospital_id DROP NOT NULL;

ALTER TABLE staff_roles
  ADD CONSTRAINT staff_roles_national_has_no_hospital
  CHECK ((role IN ('platform_admin', 'gov_viewer')) = (hospital_id IS NULL));

CREATE UNIQUE INDEX staff_users_national_email_key
  ON staff_users (lower(email)) WHERE hospital_id IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX staff_roles_national_unique
  ON staff_roles (staff_user_id, role) WHERE hospital_id IS NULL AND deleted_at IS NULL;

COMMENT ON COLUMN staff_users.hospital_id IS
  'The facility this account works for. Null only for a national account (platform_admin, gov_viewer), which works for none (FR-ROLE-01).';
COMMENT ON COLUMN staff_roles.hospital_id IS
  'Null exactly when the role is platform_admin or gov_viewer (staff_roles_national_has_no_hospital, FR-ROLE-01).';
