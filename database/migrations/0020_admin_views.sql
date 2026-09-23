-- 0020_admin_views.sql
--
-- The three objects `S-B-10` reads: `v_admin_daily`, `v_no_show_loss` and
-- `v_referral_flow` (DATABASE.md §4; `FR-ADM-01`..`FR-ADM-07`).
--
-- 0012 said each later view would "arrive in its own migration alongside the
-- step that reads them". This is that step. All three land together because
-- one screen reads all three and a dashboard with two thirds of its sections
-- is not a shippable state.
--
-- ## Why `v_admin_daily` is materialised and the other two are not
--
-- DATABASE.md §4 calls it a materialised view "refreshed every 5 min". It
-- scans every booking and every queue event a hospital has ever recorded, to
-- draw a wait-time trend going back months (`FR-ADM-02`) — that is not a query
-- to run on each page load. The other two are bounded by a date range the
-- caller passes and are cheap enough live, and live means they cannot be
-- stale, which matters more for a figure somebody is about to act on.
--
-- **Nothing refreshes it on a timer.** `pg-boss` is not installed (STATUS,
-- "known gaps"), so there is no scheduler to run `analytics.refresh.ts` every
-- five minutes. `admin.service` refreshes it on read when it is older than
-- five minutes, and the screen shows its age through `<FreshnessLine>` — the
-- same honest-degradation rule every other live figure follows (`PRD.md`
-- §3.2). When a worker process exists it takes the job over and nothing else
-- changes.
--
-- The unique index exists so the refresh can be CONCURRENT: without one,
-- PostgreSQL takes an ACCESS EXCLUSIVE lock and every dashboard read blocks
-- behind it.
--
-- ## Every figure here is per hospital and per day
--
-- A dashboard is opened by a hospital administrator for their own facility
-- (`FR-ROLE-01`), and the date range is theirs to choose. Aggregating by day
-- rather than by hour is what makes a months-long trend affordable, and no
-- requirement in §13 asks a question finer than a day.
--
-- ## What is deliberately absent
--
-- No patient identifier of any kind appears in these three objects. An admin
-- reads aggregates (DATABASE.md §5: "hospital admin reads aggregate only"),
-- and a view with a `patient_id` in it is one join away from being a way
-- around that.

-- ===========================================================================
-- v_admin_daily — one row per hospital per day (FR-ADM-01, FR-ADM-02,
-- FR-ADM-04, FR-ADM-05, FR-ADM-09)
--
-- ## Two wait figures, because the one `FR-ADM-01` names cannot be measured yet
--
-- `FR-ADM-01` wants average and longest wait. The wait a patient experiences
-- is the time between reaching the hospital and being called — and **nothing
-- in this product records a patient arriving.** `PRD.md` §8 gives reception no
-- check-in action: `FR-REC-10`..`FR-REC-16` call, finish, mark late, mark
-- absent, insert a walk-in and reorder, and none of them is "this person is
-- here". `bookings.arrived_at` is written only by `WALKIN_ADDED`, which is
-- somebody standing at the counter.
--
-- So `avg_wait_minutes` is defined correctly and is null for every booked
-- patient, today and until a check-in event exists. It is computed anyway,
-- because the day that event lands this figure starts working with no change
-- here, and `waits_measured` states how many rows it rests on so the screen
-- can say "over none".
--
-- `overrun_minutes` is the figure that *can* be measured from what the product
-- records: how much later than their slot a patient was called. The slot is
-- the session's planned start plus the doctor's own consultation rate times
-- the serials ahead of them — which is exactly what the patient was told to
-- expect, and exactly what stops being wrong when the queue runs to time. For
-- serial 1 it is the wait in full; for serial 40 it is the part of the wait
-- that nobody planned. Floored at zero: a patient called early did not wait a
-- negative time, and averaging a negative into the figure would let one early
-- start cancel somebody else's hour in a corridor.
--
-- This is a measurement choice the documents do not make, and it is recorded
-- in `docs/STATUS.md` as needing a ruling.
--
-- ## Seen means done
--
-- A patient in the chamber right now has not been seen yet. Counting them
-- would make every figure drift upward through the afternoon and settle at a
-- different number by evening, which is how a director stops trusting a
-- dashboard.
-- ===========================================================================

CREATE MATERIALIZED VIEW v_admin_daily AS
WITH booking_day AS (
  SELECT s.hospital_id,
         s.session_date,
         s.doctor_id,
         s.department_id,
         b.status,
         b.source,
         b.fee_poisha,
         b.consult_seconds,

         -- Minutes between checking in and being called. Null unless both
         -- stamps exist, which is what keeps an unmeasured queue out of the
         -- average rather than dragging it to zero.
         CASE
           WHEN b.arrived_at IS NOT NULL AND b.called_at IS NOT NULL
             THEN GREATEST(0, EXTRACT(EPOCH FROM (b.called_at - b.arrived_at)) / 60.0)
         END AS wait_minutes,

         -- How much later than their own slot the patient was called.
         CASE
           WHEN b.called_at IS NOT NULL
             THEN GREATEST(
               0,
               EXTRACT(
                 EPOCH FROM (
                   b.called_at
                   - (s.planned_start
                      + make_interval(mins => (b.serial_number - 1) * d.default_consult_minutes))
                 )
               ) / 60.0
             )
         END AS overrun_minutes
    FROM bookings b
    JOIN sessions s ON s.id = b.session_id
    JOIN doctors d  ON d.id = s.doctor_id
   WHERE b.deleted_at IS NULL
     AND s.deleted_at IS NULL
),
session_day AS (
  SELECT s.hospital_id,
         s.session_date,
         s.id,
         s.planned_start,
         s.actual_start,

         -- Signed minutes late; negative is early, which is also a broken
         -- promise (`shared/domain/src/admin/punctuality.ts` explains why).
         CASE
           WHEN s.actual_start IS NOT NULL
             THEN EXTRACT(EPOCH FROM (s.actual_start - s.planned_start)) / 60.0
         END AS start_delta_minutes,
         s.delay_minutes
    FROM sessions s
   WHERE s.deleted_at IS NULL
),
money_day AS (
  -- Joined through the booking to its session, because a payment has no date
  -- of its own that means anything to a hospital's day: a patient who pays at
  -- 23:50 for tomorrow's chamber belongs to tomorrow's takings.
  SELECT s.hospital_id,
         s.session_date,
         p.amount_poisha,
         p.refunded_poisha,
         p.method,
         p.state
    FROM payments p
    JOIN bookings b ON b.id = p.booking_id
    JOIN sessions s ON s.id = b.session_id
   WHERE p.deleted_at IS NULL
     AND b.deleted_at IS NULL
     AND s.deleted_at IS NULL
     AND p.state IN ('paid', 'refunded', 'partially_refunded')
)
SELECT h.id AS hospital_id,
       d.session_date,

       -- --- FR-ADM-01: the today view --------------------------------------
       count(*) FILTER (WHERE d.status = 'done')::int      AS seen,
       count(*) FILTER (WHERE d.status = 'no_show')::int   AS no_shows,
       count(*) FILTER (WHERE d.status = 'cancelled')::int AS cancelled,
       count(*)::int                                       AS booked_total,

       -- Walk-in versus booked (`FR-ADM-01`). `counter` and `walkin` are both
       -- somebody who turned up without an appointment; `app`, `guest_link`
       -- and `phone` all booked ahead. The ratio a hospital cares about is
       -- planned against unplanned, not which channel was used.
       count(*) FILTER (WHERE d.source IN ('walkin', 'counter'))::int AS walkin_count,
       count(*) FILTER (WHERE d.source IN ('app', 'guest_link', 'phone'))::int AS booked_count,

       round(avg(d.wait_minutes))::int AS avg_wait_minutes,
       max(d.wait_minutes)::int        AS longest_wait_minutes,
       count(d.wait_minutes)::int      AS waits_measured,

       round(avg(d.overrun_minutes))::int AS avg_overrun_minutes,
       max(d.overrun_minutes)::int        AS longest_overrun_minutes,
       count(d.overrun_minutes)::int      AS overruns_measured,

       round(avg(d.consult_seconds))::int AS avg_consult_seconds,

       -- --- FR-ADM-05: punctuality ------------------------------------------
       (SELECT count(*)::int FROM session_day sd
         WHERE sd.hospital_id = h.id AND sd.session_date = d.session_date) AS sessions_total,
       (SELECT count(*)::int FROM session_day sd
         WHERE sd.hospital_id = h.id AND sd.session_date = d.session_date
           AND sd.actual_start IS NULL) AS sessions_never_started,
       (SELECT round(avg(sd.start_delta_minutes))::int FROM session_day sd
         WHERE sd.hospital_id = h.id AND sd.session_date = d.session_date) AS avg_start_delta_minutes,

       -- `FR-ADM-01` wants "sessions running late". A session is late when it
       -- started outside the ten-minute band, or when a delay was declared —
       -- a chamber that began on time and then fell an hour behind is running
       -- late in every sense a waiting patient cares about.
       (SELECT count(*)::int FROM session_day sd
         WHERE sd.hospital_id = h.id AND sd.session_date = d.session_date
           AND (sd.start_delta_minutes > 10 OR sd.delay_minutes > 0)) AS sessions_late,

       -- --- FR-ADM-04: revenue ----------------------------------------------
       --
       -- Consultations only. Nothing in this version charges for a bed, a test
       -- or an ambulance (STATUS, "known gaps"), so a service-type breakdown
       -- would be one row and three zeroes. The zeroes are stated by the API
       -- rather than invented here.
       coalesce((SELECT sum(m.amount_poisha)::bigint FROM money_day m
                  WHERE m.hospital_id = h.id AND m.session_date = d.session_date), 0)
         AS collected_poisha,
       coalesce((SELECT sum(m.refunded_poisha)::bigint FROM money_day m
                  WHERE m.hospital_id = h.id AND m.session_date = d.session_date), 0)
         AS refunded_poisha,

       -- What the chambers were worth, whether or not anybody has paid yet.
       -- A hospital collecting at the counter has billings far above
       -- collections in this database, and reporting only the latter would
       -- understate the day by most of it.
       coalesce(sum(d.fee_poisha) FILTER (WHERE d.status = 'done'), 0)::bigint
         AS billed_poisha

  FROM booking_day d
  JOIN hospitals h ON h.id = d.hospital_id
 WHERE h.deleted_at IS NULL
 GROUP BY h.id, d.session_date;

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY, which is what keeps a
-- refresh from blocking every dashboard read behind it.
CREATE UNIQUE INDEX v_admin_daily_key ON v_admin_daily (hospital_id, session_date);

-- ---------------------------------------------------------------------------
-- analytics_refresh — when each derived object was last rebuilt
--
-- Every live figure in this product carries its age (`PRD.md` §3.2,
-- `FR-OFF-03`), and a materialised view is the one place where the age of the
-- *data* and the age of the *answer* come apart: rows can be a minute old and
-- the snapshot an hour old, and only the second is what the screen is showing.
--
-- PostgreSQL records no last-refreshed time for a materialised view, so it has
-- to be written down. Two alternatives were rejected: a `now()` column inside
-- the view is rewritten by every refresh, which makes CONCURRENTLY's row diff
-- match nothing and rewrite the whole table each time; and inferring age from
-- the newest row in the data answers a different question, because a quiet
-- afternoon would make a stale snapshot look fresh.
--
-- One row per object, written in the same transaction as the refresh, so the
-- stamp cannot claim a rebuild that rolled back.
-- ---------------------------------------------------------------------------

CREATE TABLE analytics_refresh (
  -- A uuid key on a table whose natural key is the view's name, because
  -- `DB-P9` has no exceptions but `bookings.serial_number`. The name is unique
  -- and is what the upsert conflicts on; it is simply not the primary key.
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  view_name    text        NOT NULL UNIQUE,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_analytics_refresh_touch
  BEFORE UPDATE ON analytics_refresh
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE analytics_refresh ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE analytics_refresh IS
  'When each materialised view was last rebuilt, so S-B-10 can state the age of the snapshot rather than the age of the data. Written in the refresh transaction.';

COMMENT ON MATERIALIZED VIEW v_admin_daily IS
  'Daily aggregates per hospital for S-B-10 (FR-ADM-01, FR-ADM-02, FR-ADM-04, FR-ADM-05, FR-ADM-09). Refreshed on read past five minutes by admin.service; no scheduler exists in this version. Contains no patient identifier.';

-- ===========================================================================
-- v_no_show_loss — what empty chairs cost, and what the waitlist won back
-- (FR-ADM-03, FR-QUE-31)
--
-- DATABASE.md §4 describes this as "no-show count × fee, and recovered value
-- from `slot_offers`". It carries one more column than that, and the reason is
-- the whole point of the figure.
--
-- A no-show's fee is not automatically money lost. A patient who prepaid
-- through the app and did not attend has already paid the hospital, and in
-- this version a no-show earns no refund — only doctor absence does
-- (`FR-PAY-07`). So `prepaid_poisha` is reported beside `forgone_poisha`, and
-- `shared/domain/src/admin/recovery.ts` subtracts one from the other to get
-- the honest loss. Handing a director a number that includes cash in his own
-- account is how a dashboard gets disbelieved on the first day somebody checks
-- it against the till.
--
-- Not materialised: it is bounded by the caller's date range, it is the figure
-- most likely to be acted on immediately, and a stale recovery number would
-- tell a receptionist a chair is still empty after somebody took it.
-- ===========================================================================

CREATE VIEW v_no_show_loss AS
WITH no_show AS (
  SELECT s.hospital_id,
         s.session_date,
         b.id AS booking_id,
         b.fee_poisha,

         -- What the patient had already paid and not got back. `paid` and
         -- `partially_refunded` both leave money with the hospital; `refunded`
         -- leaves none, and `pending` or `failed` never arrived.
         coalesce(
           (SELECT sum(p.amount_poisha - p.refunded_poisha)
              FROM payments p
             WHERE p.booking_id = b.id
               AND p.deleted_at IS NULL
               AND p.state IN ('paid', 'partially_refunded')),
           0
         ) AS prepaid_poisha
    FROM bookings b
    JOIN sessions s ON s.id = b.session_id
   WHERE b.status = 'no_show'
     AND b.deleted_at IS NULL
     AND s.deleted_at IS NULL
),
offers AS (
  SELECT s.hospital_id,
         s.session_date,
         o.id,
         o.accepted_at,
         o.recovered_value_poisha
    FROM slot_offers o
    JOIN sessions s ON s.id = o.session_id
   WHERE s.deleted_at IS NULL
)
SELECT hospital_id,
       session_date,
       sum(no_show_count)::int            AS no_show_count,
       sum(forgone_poisha)::bigint        AS forgone_poisha,
       sum(prepaid_poisha)::bigint        AS prepaid_poisha,
       sum(offers_made)::int              AS offers_made,
       sum(offers_accepted)::int          AS offers_accepted,
       sum(recovered_poisha)::bigint      AS recovered_poisha
  FROM (
    SELECT hospital_id, session_date,
           count(*)          AS no_show_count,
           sum(fee_poisha)   AS forgone_poisha,
           sum(prepaid_poisha) AS prepaid_poisha,
           0 AS offers_made, 0 AS offers_accepted, 0 AS recovered_poisha
      FROM no_show
     GROUP BY hospital_id, session_date

     UNION ALL

    SELECT hospital_id, session_date,
           0, 0, 0,
           count(*),
           count(*) FILTER (WHERE accepted_at IS NOT NULL),
           coalesce(sum(recovered_value_poisha) FILTER (WHERE accepted_at IS NOT NULL), 0)
      FROM offers
     GROUP BY hospital_id, session_date
  ) combined
 GROUP BY hospital_id, session_date;

COMMENT ON VIEW v_no_show_loss IS
  'FR-ADM-03. Carries prepaid_poisha as well as forgone_poisha because a prepaid no-show is money the hospital kept, not money it lost; shared/domain/admin/recovery.ts does the subtraction.';

-- ===========================================================================
-- v_referral_flow — sent, received, accepted, leaked (FR-ADM-07)
--
-- ## What "leaked" means, and why it is counted where it is
--
-- A leak is a patient this hospital referred *out* — care, and the fee that
-- goes with it, that went to another facility. `PRD.md` §62 names it as one of
-- the three things a hospital loses money to and cannot see.
--
-- So a leak is counted against the *sending* hospital. Every referral this
-- facility sent that the other end accepted or the patient arrived at is a
-- leak; one that was declined or cancelled is not, because the patient stayed.
-- A referral still in flight is neither yet, and is reported as open rather
-- than being guessed either way.
--
-- The mirror image — referrals *received* — is the same rows read from the
-- other side, which is why one view carries both and a hospital's row has a
-- sent half and a received half.
-- ===========================================================================

CREATE VIEW v_referral_flow AS
WITH sent AS (
  SELECT from_hospital_id AS hospital_id,
         count(*)                                                       AS sent_total,
         count(*) FILTER (WHERE state IN ('accepted', 'arrived'))       AS sent_accepted,
         count(*) FILTER (WHERE state = 'declined')                     AS sent_declined,
         count(*) FILTER (WHERE state IN ('sent', 'seen'))              AS sent_open,
         count(*) FILTER (WHERE state = 'arrived')                      AS leaked_confirmed,
         count(*) FILTER (WHERE state IN ('accepted', 'arrived'))       AS leaked,
         min(sent_at)                                                   AS first_sent_at,
         max(sent_at)                                                   AS last_sent_at
    FROM referrals
   WHERE deleted_at IS NULL
   GROUP BY from_hospital_id
),
received AS (
  SELECT to_hospital_id AS hospital_id,
         count(*)                                                 AS received_total,
         count(*) FILTER (WHERE state IN ('accepted', 'arrived')) AS received_accepted,
         count(*) FILTER (WHERE state = 'declined')               AS received_declined,
         count(*) FILTER (WHERE state IN ('sent', 'seen'))        AS received_open,
         count(*) FILTER (WHERE state = 'arrived')                AS received_arrived,
         max(sent_at)                                             AS last_received_at
    FROM referrals
   WHERE deleted_at IS NULL
   GROUP BY to_hospital_id
)
SELECT h.id AS hospital_id,
       coalesce(s.sent_total, 0)::int        AS sent_total,
       coalesce(s.sent_accepted, 0)::int     AS sent_accepted,
       coalesce(s.sent_declined, 0)::int     AS sent_declined,
       coalesce(s.sent_open, 0)::int         AS sent_open,
       coalesce(s.leaked, 0)::int            AS leaked,
       coalesce(s.leaked_confirmed, 0)::int  AS leaked_confirmed,
       coalesce(r.received_total, 0)::int    AS received_total,
       coalesce(r.received_accepted, 0)::int AS received_accepted,
       coalesce(r.received_declined, 0)::int AS received_declined,
       coalesce(r.received_open, 0)::int     AS received_open,
       coalesce(r.received_arrived, 0)::int  AS received_arrived,

       -- The freshness stamp `FR-ADM-07`'s section renders. Null when this
       -- hospital has never sent or received one, which the screen states as
       -- "no referrals yet" rather than as a zero-aged figure.
       greatest(s.last_sent_at, r.last_received_at) AS as_of
  FROM hospitals h
  LEFT JOIN sent s     ON s.hospital_id = h.id
  LEFT JOIN received r ON r.hospital_id = h.id
 WHERE h.deleted_at IS NULL;

COMMENT ON VIEW v_referral_flow IS
  'FR-ADM-07. A leak is counted against the sending hospital: care this facility referred out and the other end took. Declined and cancelled referrals are not leaks — the patient stayed.';
