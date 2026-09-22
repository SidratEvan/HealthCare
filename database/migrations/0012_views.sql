-- 0012_views.sql
--
-- `v_public_hospital_capacity` — the only source the public API reads bed
-- figures from (DATABASE.md §4, §5; `FR-PAT-14`, `FR-PAT-51`, `FR-BED-05`).
--
-- ## Why this file holds one view and not "all v_* views"
--
-- DATABASE.md §7 describes 0012 as every view. That cannot hold in a build
-- that ships a step at a time: `v_admin_daily` needs `payments` (0009),
-- `v_no_show_loss` needs the recovery flow of step 15, and a shipped migration
-- is never edited. So 0012 carries the view step 14 needs, and each later view
-- arrives in its own migration alongside the step that reads it. DATABASE.md §7
-- is updated to say so.
--
-- ## What "free" means here, exactly
--
-- A bed is free when its state is `free`, **or** when it is reserved and the
-- hold has lapsed. The second half is what lets an expired hold stop hiding a
-- bed from the public the moment it expires, without anything having to run
-- on a timer: the ward board writes the logged RELEASE the next time it is
-- opened, but a family searching in the meantime is not told the bed is taken
-- (`BTN-B06-RESERVE`: "expiry auto-releases").
--
-- A bed out of service is not counted at all — neither free nor in the total.
-- A bed with a broken oxygen line is not capacity, and "3 free of 20" where two
-- of the twenty cannot be used overstates what the hospital can take.
--
-- ## Freshness, and why there are two stamps
--
-- DATABASE.md §4 gives this view one `as_of`. The figures in it are confirmed
-- by different people at different times — beds by the ward, capabilities by
-- the ER coordinator (`FR-EMG-05`) — so one stamp would have to be the age of
-- one of them and would lie about the other. There are two:
--
--   beds_as_of        the *oldest* of the per-kind stamps. A total built from
--                     a general ward updated a minute ago and an ICU nobody
--                     has touched in five hours is five hours old in part, and
--                     `PRD.md` §3.2 says to show the worse age, not the better.
--                     Null when any kind has never been confirmed at all.
--   capability_as_of  the newest capability change, as discovery already
--                     reported it.
--
-- Each kind also carries its own `asOf` inside `by_kind`, because `FR-PAT-51`
-- puts a freshness line on every bed type separately.
--
-- A kind's stamp is the newest `bed_events.server_ts` among its beds: the last
-- moment somebody on that ward told the system something. It is not the time
-- of this read. A number nobody has confirmed for an hour is an hour old,
-- however recently it was fetched.

CREATE VIEW v_public_hospital_capacity AS
WITH bed_now AS (
  SELECT b.hospital_id,
         b.kind,
         b.nightly_poisha,
         b.state <> 'out_of_service' AS in_service,
         (b.state = 'free' OR (b.state = 'reserved' AND b.reserved_until <= now())) AS is_free
    FROM beds b
   WHERE b.deleted_at IS NULL
),
per_kind AS (
  SELECT bn.hospital_id,
         bn.kind,
         count(*) FILTER (WHERE bn.in_service)               AS total,
         count(*) FILTER (WHERE bn.in_service AND bn.is_free) AS free,
         min(bn.nightly_poisha) FILTER (WHERE bn.in_service)  AS nightly_min_poisha,
         max(bn.nightly_poisha) FILTER (WHERE bn.in_service)  AS nightly_max_poisha
    FROM bed_now bn
   GROUP BY bn.hospital_id, bn.kind
),
kind_fresh AS (
  SELECT e.hospital_id, b.kind, max(e.server_ts) AS as_of
    FROM bed_events e
    JOIN beds b ON b.id = e.bed_id
   WHERE b.deleted_at IS NULL
   GROUP BY e.hospital_id, b.kind
),
kinds AS (
  SELECT pk.hospital_id, pk.kind, pk.total, pk.free,
         pk.nightly_min_poisha, pk.nightly_max_poisha, kf.as_of
    FROM per_kind pk
    LEFT JOIN kind_fresh kf ON kf.hospital_id = pk.hospital_id AND kf.kind = pk.kind
)
SELECT h.id AS hospital_id,

       -- Zero only when the hospital has beds and none are in service. A
       -- facility with no beds at all — a diagnostic centre — has a total of
       -- zero *and* an empty `by_kind`, which is how a client tells "no
       -- inpatient beds here" from "none free".
       coalesce(sum(k.total), 0)::int AS bed_total,
       coalesce(sum(k.free), 0)::int  AS bed_free,

       -- Null, not zero, when the hospital has no ICU: "no ICU" and "ICU full"
       -- send a family to different places (`FR-PAT-14`).
       (sum(k.total) FILTER (WHERE k.kind = 'icu'))::int AS icu_total,
       (sum(k.free)  FILTER (WHERE k.kind = 'icu'))::int AS icu_free,
       max(k.as_of)  FILTER (WHERE k.kind = 'icu')       AS icu_as_of,

       CASE
         WHEN count(k.kind) = 0 THEN NULL
         WHEN bool_or(k.as_of IS NULL) THEN NULL
         ELSE min(k.as_of)
       END AS beds_as_of,

       -- Ordered by `bed_kind`'s declaration order (general, cabin, hdu, icu,
       -- …), which is the order `CHIP-A11-<type>` lists them in.
       coalesce(
         jsonb_agg(
           jsonb_build_object(
             'kind', k.kind,
             'total', k.total,
             'free', k.free,
             'nightlyMinPoisha', k.nightly_min_poisha,
             'nightlyMaxPoisha', k.nightly_max_poisha,
             'asOf', k.as_of
           )
           ORDER BY k.kind
         ) FILTER (WHERE k.kind IS NOT NULL),
         '[]'::jsonb
       ) AS by_kind,

       -- `FR-EMG-04`: derived from active cases, never typed. Nothing writes
       -- `emergency_cases` until build step 15, and the API does not publish
       -- this figure until then — a zero from a console that does not exist
       -- would read as "the ER is quiet".
       (SELECT count(*)::int
          FROM emergency_cases ec
         WHERE ec.hospital_id = h.id
           AND ec.deleted_at IS NULL
           AND ec.state IN ('inbound', 'acknowledged', 'arrived', 'in_treatment')) AS er_active,

       (SELECT coalesce(array_agg(c.kind::text ORDER BY c.kind), '{}')
          FROM capabilities c
         WHERE c.hospital_id = h.id AND c.is_available) AS capabilities,
       (SELECT max(c.updated_at)
          FROM capabilities c
         WHERE c.hospital_id = h.id) AS capability_as_of
  FROM hospitals h
  LEFT JOIN kinds k ON k.hospital_id = h.id
 WHERE h.deleted_at IS NULL
 GROUP BY h.id;

COMMENT ON VIEW v_public_hospital_capacity IS
  'Per hospital: beds free by kind with nightly price and freshness, ICU, active ER cases, capabilities. The only source the public API reads (DATABASE.md §5, FR-PAT-14).';
