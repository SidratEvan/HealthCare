-- 0034_refresh_as_owner.sql
--
-- Lets a role that does not own `v_admin_daily` rebuild it
-- (`docs/PLATFORM_PLAN.md` 1.7).
--
-- PostgreSQL lets only the owner of a materialised view refresh it; there is
-- no privilege to grant for it in version 16. That was invisible while the API
-- connected as the owner. On a hospital's server it now connects as a role
-- that owns nothing (`database/scripts/lib/role.ts`), and the dashboard's
-- refresh-on-read (`admin.service`, `FR-ADM-01`) would have been refused.
--
-- The alternative was to hand the view to the API's role, which would also let
-- it drop or redefine the view. A function that does exactly one thing with
-- the owner's rights gives away less.

SET LOCAL search_path = public, extensions;

CREATE FUNCTION fn_refresh_admin_daily()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
-- Pinned, as every SECURITY DEFINER function must be: resolved against the
-- caller's search_path it would run whatever the caller put in front.
SET search_path = public, extensions
AS $$
BEGIN
  -- CONCURRENTLY, so a rebuild does not make every dashboard read wait behind
  -- it (0020 creates the unique index this needs).
  REFRESH MATERIALIZED VIEW CONCURRENTLY v_admin_daily;
END;
$$;

COMMENT ON FUNCTION fn_refresh_admin_daily() IS
  'Rebuilds v_admin_daily with the owner''s rights, so the API''s role can ask for a refresh without owning the view (FR-ADM-01). Takes no argument and touches nothing else.';

-- Not for everyone: `gov_reader` has no business rebuilding a hospital's
-- figures. The API's role is granted EXECUTE with the rest of its privileges
-- (`pnpm db:role`); the owner needs no grant.
REVOKE ALL ON FUNCTION fn_refresh_admin_daily() FROM PUBLIC;
