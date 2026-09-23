-- 0026_gov_views.sql
--
-- The national layer (`S-B-13`, `FR-GOV-01`..`FR-GOV-06`): five aggregate
-- views, and a database role that can read those five and nothing else.
--
-- ## The rule this file exists to make true
--
-- `DATABASE.md` §5: "`gov_viewer` may read only the aggregate views, never
-- base tables." `FR-GOV-06`: "No patient identifiers are exposed in this layer
-- under any configuration." `FR-ROLE-04`: "R11 can never reach a row that
-- identifies a patient."
--
-- A query that happens not to select a name satisfies none of those. They
-- are statements about what is *reachable*, and a repository that joins
-- `patients` by mistake next year would reach it. So the government layer
-- reads as `gov_reader`, a role holding SELECT on these views alone: the API
-- sets it for the length of each read (`gov.repo.ts`, `SET LOCAL ROLE`), and
-- from inside that transaction `SELECT * FROM patients` is refused by the
-- database — not by a code review. The views run with their owner's rights,
-- which is what lets them aggregate tables the role itself cannot open.
--
-- ## No identifier in any column
--
-- Not a patient id, a booking id, a visit id, a case id or a facility id. The
-- finest grain anywhere below is a district, except `v_gov_benchmark`, which
-- is per facility by necessity and carries the facility's *kind* and nothing
-- that names it (`FR-GOV-04`: "anonymised facility benchmarking").
--
-- ## What is not here, because nothing records it
--
-- `FR-GOV-01` lists ventilators and blood availability. No table holds either:
-- `bed_kind` has no ventilator, and blood stock by group is decision 47 — 0011
-- brought donors and requests, neither of which is an inventory. The service
-- reports both as unrecorded rather than as zero (`PRD.md` §3.2).

-- ===========================================================================
-- v_gov_capacity — beds, ICU and burn capacity by district (FR-GOV-01)
--
-- Built on `v_public_hospital_capacity`, the figures a family already sees, so
-- the ministry and the public can never be told different numbers about the
-- same ward. Summed per district across live facilities.
--
-- Freshness follows `PRD.md` §3.2 up a level: a district's beds are as old as
-- its *oldest* facility's, and null when any facility with beds has never
-- confirmed them. A district total that mixes a ward updated a minute ago with
-- one nobody has touched since morning is partly a morning figure.
-- ===========================================================================

CREATE VIEW v_gov_capacity AS
WITH facility AS (
  SELECT h.division,
         h.district,
         c.bed_total,
         c.bed_free,
         c.icu_total,
         c.icu_free,
         c.beds_as_of,
         c.by_kind,
         c.er_active,
         c.capabilities,
         c.capability_as_of
    FROM v_public_hospital_capacity c
    JOIN hospitals h ON h.id = c.hospital_id
   WHERE h.is_live AND h.deleted_at IS NULL
),
kind_rows AS (
  SELECT f.division,
         f.district,
         k ->> 'kind'                AS kind,
         (k ->> 'total')::int        AS total,
         (k ->> 'free')::int         AS free,
         (k ->> 'asOf')::timestamptz AS as_of
    FROM facility f
    CROSS JOIN LATERAL jsonb_array_elements(f.by_kind) AS k
),
kinds AS (
  SELECT kr.division,
         kr.district,
         jsonb_agg(
           jsonb_build_object(
             'kind', kr.kind,
             'total', kr.total,
             'free', kr.free,
             'asOf', kr.as_of
           )
           ORDER BY kr.kind
         ) AS by_kind
    FROM (
      SELECT division, district, kind,
             sum(total)::int AS total,
             sum(free)::int  AS free,
             CASE WHEN bool_or(as_of IS NULL) THEN NULL ELSE min(as_of) END AS as_of
        FROM kind_rows
       GROUP BY division, district, kind
    ) kr
   GROUP BY kr.division, kr.district
),
district AS (
  SELECT f.division,
         f.district,
         count(*)::int AS facilities,
         sum(f.bed_total)::int AS bed_total,
         sum(f.bed_free)::int  AS bed_free,

         -- Null, not zero, when no facility in the district has an ICU — the
         -- same distinction `v_public_hospital_capacity` draws for one facility.
         sum(f.icu_total)::int AS icu_total,
         sum(f.icu_free)::int  AS icu_free,

         count(*) FILTER (WHERE 'burn_unit' = ANY (f.capabilities))::int AS burn_units_open,
         sum(f.er_active)::int AS er_active,

         CASE
           WHEN bool_or(f.bed_total > 0 AND f.beds_as_of IS NULL) THEN NULL
           ELSE min(f.beds_as_of) FILTER (WHERE f.bed_total > 0)
         END AS beds_as_of,
         CASE
           WHEN bool_or(f.capability_as_of IS NULL) THEN NULL
           ELSE min(f.capability_as_of)
         END AS capability_as_of
    FROM facility f
   GROUP BY f.division, f.district
)
SELECT d.*,
       coalesce(k.by_kind, '[]'::jsonb) AS by_kind
  FROM district d
  LEFT JOIN kinds k ON k.division = d.division AND k.district = d.district;

COMMENT ON VIEW v_gov_capacity IS
  'Beds by kind, ICU, burn units open and ER load per district, from v_public_hospital_capacity. No facility, no patient (FR-GOV-01, FR-GOV-06).';

-- ===========================================================================
-- v_gov_er_hourly — emergency arrivals by district and hour (FR-GOV-02)
--
-- The heat map for disaster response: where people are arriving, hour by hour.
-- An arrival is the moment the ER recorded the person, or — for a family who
-- sent "I'm on my way" and never came — the alert, because a district flooded
-- with alerts is under load whether or not everybody made it.
--
-- `red` is the share of that load the ER triaged as critical: a district with
-- forty green arrivals and one with forty red are not the same afternoon.
-- ===========================================================================

CREATE VIEW v_gov_er_hourly AS
SELECT h.division,
       h.district,
       date_trunc('hour', coalesce(ec.arrived_at, ec.inbound_at, ec.created_at)) AS hour,
       count(*)::int                                     AS cases,
       count(*) FILTER (WHERE ec.triage = 'red')::int    AS red
  FROM emergency_cases ec
  JOIN hospitals h ON h.id = ec.hospital_id
 WHERE ec.deleted_at IS NULL
   AND h.is_live AND h.deleted_at IS NULL
 GROUP BY h.division, h.district, date_trunc('hour', coalesce(ec.arrived_at, ec.inbound_at, ec.created_at));

COMMENT ON VIEW v_gov_er_hourly IS
  'Emergency arrivals (or alerts) per district per hour, with the critical share. Counts only (FR-GOV-02, FR-GOV-06).';

-- ===========================================================================
-- v_gov_er_now — emergency load right now, by district (FR-GOV-02)
--
-- `FR-EMG-04`'s counter summed: open cases, of which on the way, of which
-- critical. Its age is the newest thing any ER in the district recorded — the
-- last moment somebody at a console told the system something.
-- ===========================================================================

CREATE VIEW v_gov_er_now AS
SELECT h.division,
       h.district,
       count(ec.id) FILTER (
         WHERE ec.state IN ('inbound', 'acknowledged', 'arrived', 'in_treatment')
       )::int AS open,
       count(ec.id) FILTER (WHERE ec.state IN ('inbound', 'acknowledged'))::int AS on_the_way,
       count(ec.id) FILTER (
         WHERE ec.state IN ('arrived', 'in_treatment') AND ec.triage = 'red'
       )::int AS red,
       max(greatest(ec.created_at, ec.updated_at)) AS as_of
  FROM hospitals h
  JOIN emergency_cases ec ON ec.hospital_id = h.id AND ec.deleted_at IS NULL
 WHERE h.is_live AND h.deleted_at IS NULL
 GROUP BY h.division, h.district;

COMMENT ON VIEW v_gov_er_now IS
  'Open emergency cases per district now, on the way and critical, with the age of the newest update (FR-GOV-02).';

-- ===========================================================================
-- v_gov_symptom_daily — tagged visits by district, category and day (FR-GOV-03)
--
-- The count a spike is measured against: signed visits a doctor tagged dengue,
-- diarrhoeal or fever (0025), by the Dhaka calendar day they were signed. A
-- draft is not a case yet. Nothing else about the visit leaves this view.
-- ===========================================================================

CREATE VIEW v_gov_symptom_daily AS
SELECT h.division,
       h.district,
       v.symptom_signal::text AS signal,
       (v.signed_at AT TIME ZONE 'Asia/Dhaka')::date AS day,
       count(*)::int AS cases
  FROM visits v
  JOIN hospitals h ON h.id = v.hospital_id
 WHERE v.symptom_signal IS NOT NULL
   AND v.signed_at IS NOT NULL
   AND v.deleted_at IS NULL
   AND h.is_live AND h.deleted_at IS NULL
 GROUP BY h.division, h.district, v.symptom_signal, (v.signed_at AT TIME ZONE 'Asia/Dhaka')::date;

COMMENT ON VIEW v_gov_symptom_daily IS
  'Signed visits tagged dengue, diarrhoeal or fever, per district per Dhaka day. Counts only (FR-GOV-03, FR-GOV-06).';

-- ===========================================================================
-- v_gov_reporting — how long each district has been reporting (FR-GOV-03)
--
-- A spike is this week against the weeks before it, and a district whose
-- facilities began recording visits on Tuesday has no weeks before it. Zero
-- tagged cases last month is a baseline only if somebody was there to tag
-- them, so the signal needs the first signed visit of *any* kind, and the
-- newest one is the age of the whole feed.
-- ===========================================================================

CREATE VIEW v_gov_reporting AS
SELECT h.division,
       h.district,
       min((v.signed_at AT TIME ZONE 'Asia/Dhaka')::date) AS first_day,
       max(v.signed_at) AS last_signed_at
  FROM visits v
  JOIN hospitals h ON h.id = v.hospital_id
 WHERE v.signed_at IS NOT NULL
   AND v.deleted_at IS NULL
   AND h.is_live AND h.deleted_at IS NULL
 GROUP BY h.division, h.district;

COMMENT ON VIEW v_gov_reporting IS
  'Per district: the first Dhaka day any visit was signed, and the newest signature — what a symptom baseline rests on (FR-GOV-03).';

-- ===========================================================================
-- v_gov_benchmark — facilities compared, none named (FR-GOV-04)
--
-- One row per live facility over the last thirty days: the wait from check-in
-- to call (`FR-REC-18`, the definition `v_admin_daily` uses), the lab's
-- ordered-to-ready turnaround (decision 56), and the four feedback scores
-- (`FR-PAT-83`). Each figure travels with the count it rests on, because a
-- median over two lab orders is not a benchmark and the domain suppresses it
-- (`shared/domain/gov/benchmark.ts`).
--
-- The facility's kind is the only thing about it here. A ministry comparing
-- government with private facilities needs that much; a column that named
-- one would make this a league table, which is not what `FR-GOV-04` asks for.
-- ===========================================================================

CREATE VIEW v_gov_benchmark AS
WITH window_start AS (
  SELECT now() - interval '30 days' AS since
),
waits AS (
  SELECT s.hospital_id,
         avg(EXTRACT(EPOCH FROM (b.called_at - b.arrived_at)) / 60.0) AS avg_wait_minutes,
         count(*)::int AS waits_measured
    FROM bookings b
    JOIN sessions s ON s.id = b.session_id
   CROSS JOIN window_start w
   WHERE b.deleted_at IS NULL
     AND b.arrived_at IS NOT NULL
     AND b.called_at IS NOT NULL
     AND b.called_at >= b.arrived_at
     AND b.called_at >= w.since
   GROUP BY s.hospital_id
),
turnaround AS (
  SELECT t.hospital_id,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (t.ready_at - t.created_at)) / 3600.0
         ) AS median_turnaround_hours,
         count(*)::int AS turnarounds_measured
    FROM test_orders t
   CROSS JOIN window_start w
   WHERE t.deleted_at IS NULL
     AND t.ready_at IS NOT NULL
     AND t.ready_at >= w.since
   GROUP BY t.hospital_id
),
scores AS (
  SELECT f.hospital_id,
         avg(f.wait_score)::numeric        AS wait_score,
         avg(f.doctor_score)::numeric      AS doctor_score,
         avg(f.cleanliness_score)::numeric AS cleanliness_score,
         avg(f.billing_score)::numeric     AS billing_score,
         count(*)::int                     AS responses
    FROM feedback f
   CROSS JOIN window_start w
   WHERE f.deleted_at IS NULL
     AND f.created_at >= w.since
   GROUP BY f.hospital_id
)
SELECT h.kind::text AS kind,
       wt.avg_wait_minutes::float8          AS avg_wait_minutes,
       coalesce(wt.waits_measured, 0)       AS waits_measured,
       ta.median_turnaround_hours::float8   AS median_turnaround_hours,
       coalesce(ta.turnarounds_measured, 0) AS turnarounds_measured,
       sc.wait_score::float8                AS wait_score,
       sc.doctor_score::float8              AS doctor_score,
       sc.cleanliness_score::float8         AS cleanliness_score,
       sc.billing_score::float8             AS billing_score,
       coalesce(sc.responses, 0)            AS responses
  FROM hospitals h
  LEFT JOIN waits wt      ON wt.hospital_id = h.id
  LEFT JOIN turnaround ta ON ta.hospital_id = h.id
  LEFT JOIN scores sc     ON sc.hospital_id = h.id
 WHERE h.is_live AND h.deleted_at IS NULL;

COMMENT ON VIEW v_gov_benchmark IS
  'Per live facility, unnamed: 30-day wait, lab turnaround and feedback scores with their sample sizes, and the facility kind only (FR-GOV-04, FR-GOV-06).';

-- ===========================================================================
-- gov_reader — the only thing the government layer reads as
--
-- NOLOGIN: nobody connects as it. The API's own connection switches to it
-- inside a transaction and is switched back when the transaction ends, so the
-- grant below is what lets that connection do so. Roles are cluster-wide and
-- this migration runs once per database, hence the existence check.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gov_reader') THEN
    CREATE ROLE gov_reader NOLOGIN;
  END IF;
END
$$;

GRANT gov_reader TO CURRENT_USER;

GRANT USAGE ON SCHEMA public TO gov_reader;

GRANT SELECT ON
  v_gov_capacity,
  v_gov_er_hourly,
  v_gov_er_now,
  v_gov_symptom_daily,
  v_gov_reporting,
  v_gov_benchmark
TO gov_reader;
