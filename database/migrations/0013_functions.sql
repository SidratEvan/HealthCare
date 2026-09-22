-- 0013_functions.sql
--
-- `fn_nearby_hospitals` — the geographic half of emergency search
-- (DATABASE.md §4, §6; `FR-PAT-43`).
--
-- ## Why this file holds one function and not "every fn_*"
--
-- DATABASE.md §7 describes 0013 as every `fn_*` function and the remaining
-- triggers. That cannot hold in a build that ships a step at a time, for the
-- reason 0012 gives about views: most of those functions read or rebuild
-- things later steps create, and a shipped migration is never edited. So 0013
-- carries the function step 15 needs, and each later function arrives in its
-- own migration with the step that calls it. DATABASE.md §7 says so.
--
-- ## What this function does, and what it deliberately does not
--
-- DATABASE.md §6: "emergency search filters by radius first, then ranks." This
-- is the filter. It returns every live facility within the radius, nearest
-- first, with its straight-line distance and whether the capability asked for
-- is available *right now* (`capabilities.is_available`, which is an
-- operational fact the ER coordinator keeps true — `FR-EMG-05`).
--
-- It does not rank. `FR-PAT-43`'s order — capability, then travel time, then
-- emergency load, then free beds — and `FR-PAT-45`'s de-ranking of stale data
-- live in `shared/domain/src/emergency/ranking.ts`, as BACKEND.md §2 places
-- them, because travel time is not a database fact: it comes from an adapter
-- (`TRAVEL_TIME_MODE`) that may one day be a routing API.
--
-- It does not filter out a facility that lacks the capability either. `FR-PAT-43`
-- makes capability the first *ranking* key, not a filter, and `S-A-10b`'s card
-- shows আছে / নেই — a family is better served by "the nearest hospital cannot
-- treat burns" than by that hospital silently missing from the list.
--
-- ## The caller's position is not stored
--
-- A latitude and longitude arrive, are used, and are gone. Nothing here or in
-- `emergency_cases` records where somebody was standing when they searched.

CREATE FUNCTION fn_nearby_hospitals(
  p_lat         double precision,
  p_lng         double precision,
  -- Null when the problem needs no particular capability (`FR-PAT-42`'s
  -- "other", for instance); `has_capability` is then null, not false.
  p_capability  capability_kind,
  p_radius_m    double precision
)
RETURNS TABLE (
  hospital_id     uuid,
  distance_m      double precision,
  has_capability  boolean
)
LANGUAGE sql
STABLE
-- `geography` and `ST_*` live in the `extensions` schema (0001). A function
-- body resolves names at call time with the *caller's* search path, so it is
-- pinned here rather than trusted to every connection that might call it.
SET search_path = public, extensions
AS $$
  SELECT h.id,
         ST_Distance(h.geo, origin.geo) AS distance_m,
         CASE
           WHEN p_capability IS NULL THEN NULL
           ELSE EXISTS (
             SELECT 1
               FROM capabilities c
              WHERE c.hospital_id = h.id
                AND c.kind = p_capability
                AND c.is_available
           )
         END AS has_capability
    FROM hospitals h
   CROSS JOIN LATERAL (
     SELECT ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography AS geo
   ) origin
   WHERE h.deleted_at IS NULL
     AND h.is_live
     -- A facility with no coordinate cannot be given a distance, and a guessed
     -- one is the confident wrong answer `hospitals_lat_in_bangladesh` exists
     -- to prevent. It is left out rather than placed.
     AND h.geo IS NOT NULL
     AND ST_DWithin(h.geo, origin.geo, p_radius_m)
   ORDER BY distance_m, h.id
$$;

COMMENT ON FUNCTION fn_nearby_hospitals(double precision, double precision, capability_kind, double precision) IS
  'Live facilities within a radius, nearest first, with distance and whether a capability is available now. The filter half of emergency search; ranking is shared/domain (FR-PAT-43, DATABASE.md §6).';
