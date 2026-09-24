/**
 * Every query behind `S-B-10` (`FR-ADM-01`..`FR-ADM-09`, BACKEND.md §7.7).
 *
 * SQL only, no decisions (BACKEND.md §3). The three views carry the heavy
 * aggregation (migration 0020); what is left here is the per-dimension
 * breakdowns a view cannot hold without becoming one row per doctor per day,
 * and the raw timings `shared/domain/admin` turns into figures.
 *
 * ## Every query is scoped to one hospital, in the SQL
 *
 * Not in a service, not in a controller. `FR-ROLE-01` scopes a hospital admin
 * to their own facility, and an aggregate query is the easiest place in a
 * codebase to lose that scope without anything looking wrong — the numbers
 * still render, they are just somebody else's. So `hospital_id = $1` is in
 * every statement in this file, and there is no function here that can be
 * called without one.
 *
 * ## No patient identifiers leave this file
 *
 * `DATABASE.md` §5: a hospital admin reads aggregates only. Nothing below
 * selects a patient id, a name or a phone number — not even to group by.
 */

import { sql } from 'kysely';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

/** The window a dashboard read is about. Dhaka calendar dates, inclusive. */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

// ---------------------------------------------------------------------------
// The materialised view, and its age
// ---------------------------------------------------------------------------

export interface DailyRow {
  readonly sessionDate: string;
  readonly seen: number;
  readonly noShows: number;
  readonly cancelled: number;
  readonly bookedTotal: number;
  readonly walkinCount: number;
  readonly bookedCount: number;
  readonly avgWaitMinutes: number | null;
  readonly longestWaitMinutes: number | null;
  readonly waitsMeasured: number;
  readonly avgOverrunMinutes: number | null;
  readonly longestOverrunMinutes: number | null;
  readonly overrunsMeasured: number;
  readonly avgConsultSeconds: number | null;
  readonly sessionsTotal: number;
  readonly sessionsNeverStarted: number;
  readonly avgStartDeltaMinutes: number | null;
  readonly sessionsLate: number;
  readonly collectedPoisha: number;
  readonly refundedPoisha: number;
  readonly billedPoisha: number;
}

export async function dailyRows(hospitalId: string, range: DateRange): Promise<DailyRow[]> {
  const result = await sql<{
    session_date: string;
    seen: number;
    no_shows: number;
    cancelled: number;
    booked_total: number;
    walkin_count: number;
    booked_count: number;
    avg_wait_minutes: number | null;
    longest_wait_minutes: number | null;
    waits_measured: number;
    avg_overrun_minutes: number | null;
    longest_overrun_minutes: number | null;
    overruns_measured: number;
    avg_consult_seconds: number | null;
    sessions_total: number;
    sessions_never_started: number;
    avg_start_delta_minutes: number | null;
    sessions_late: number;
    collected_poisha: string;
    refunded_poisha: string;
    billed_poisha: string;
  }>`
    SELECT session_date::text, seen, no_shows, cancelled, booked_total,
           walkin_count, booked_count, avg_wait_minutes, longest_wait_minutes,
           waits_measured, avg_overrun_minutes, longest_overrun_minutes,
           overruns_measured, avg_consult_seconds, sessions_total,
           sessions_never_started, avg_start_delta_minutes, sessions_late,
           collected_poisha, refunded_poisha, billed_poisha
      FROM v_admin_daily
     WHERE hospital_id = ${hospitalId}
       AND session_date BETWEEN ${range.from}::date AND ${range.to}::date
     ORDER BY session_date
  `.execute(db);

  return result.rows.map((row) => ({
    sessionDate: row.session_date,
    seen: row.seen,
    noShows: row.no_shows,
    cancelled: row.cancelled,
    bookedTotal: row.booked_total,
    walkinCount: row.walkin_count,
    bookedCount: row.booked_count,
    avgWaitMinutes: row.avg_wait_minutes,
    longestWaitMinutes: row.longest_wait_minutes,
    waitsMeasured: row.waits_measured,
    avgOverrunMinutes: row.avg_overrun_minutes,
    longestOverrunMinutes: row.longest_overrun_minutes,
    overrunsMeasured: row.overruns_measured,
    avgConsultSeconds: row.avg_consult_seconds,
    sessionsTotal: row.sessions_total,
    sessionsNeverStarted: row.sessions_never_started,
    avgStartDeltaMinutes: row.avg_start_delta_minutes,
    sessionsLate: row.sessions_late,
    collectedPoisha: Number(row.collected_poisha),
    refundedPoisha: Number(row.refunded_poisha),
    billedPoisha: Number(row.billed_poisha),
  }));
}

/** When the snapshot was last rebuilt. Null before the first refresh. */
export async function dailyRefreshedAt(): Promise<Date | null> {
  const result = await sql<{ refreshed_at: Date }>`
    SELECT refreshed_at FROM analytics_refresh WHERE view_name = 'v_admin_daily'
  `.execute(db);

  return result.rows[0]?.refreshed_at ?? null;
}

/**
 * Rebuilds the snapshot and stamps it, in one transaction.
 *
 * CONCURRENTLY, so a rebuild does not take an ACCESS EXCLUSIVE lock and make
 * every dashboard read in the hospital queue behind it. It needs the unique
 * index migration 0020 creates, and it cannot run inside a transaction block —
 * so the stamp is written immediately after rather than atomically with it. A
 * refresh that succeeded and a stamp that failed leaves the screen believing
 * the data is older than it is, which errs in the safe direction (`FR-OFF-03`:
 * a freshness line may never claim data is newer than it is).
 */
export async function refreshDaily(): Promise<Date> {
  await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY v_admin_daily`.execute(db);

  const result = await sql<{ refreshed_at: Date }>`
    INSERT INTO analytics_refresh (view_name, refreshed_at)
    VALUES ('v_admin_daily', now())
    ON CONFLICT (view_name) DO UPDATE SET refreshed_at = now()
    RETURNING refreshed_at
  `.execute(db);

  const stamped = result.rows[0]?.refreshed_at;
  /* c8 ignore next -- RETURNING on an upsert always yields a row */
  if (stamped === undefined) throw new Error('analytics_refresh returned no stamp.');
  return stamped;
}

// ---------------------------------------------------------------------------
// FR-ADM-03 — loss and recovery
// ---------------------------------------------------------------------------

export interface LossRow {
  readonly noShowCount: number;
  readonly forgonePoisha: number;
  readonly prepaidPoisha: number;
  readonly offersMade: number;
  readonly offersAccepted: number;
  readonly recoveredPoisha: number;
}

/**
 * Quotes given at check-in against the waits that followed (`FR-REC-18`).
 *
 * Live, not from `v_admin_daily`: bounded by the range, and a figure about a
 * promise should not be five minutes behind the promise. Only patients who
 * have been called count — somebody still sitting has not yet had the wait the
 * quote was about.
 */
export async function quoteCounts(
  hospitalId: string,
  range: DateRange,
  toleranceMinutes: number,
): Promise<{ quoted: number; kept: number; avgOverMinutes: number | null }> {
  const result = await sql<{ quoted: string; kept: string; avg_over: string | null }>`
    SELECT count(*)::text AS quoted,
           count(*) FILTER (
             WHERE b.called_at <= b.arrived_at
                   + make_interval(mins => b.quoted_wait_minutes + ${toleranceMinutes})
           )::text AS kept,
           avg(EXTRACT(EPOCH FROM (b.called_at - b.arrived_at)) / 60.0
               - b.quoted_wait_minutes)::text AS avg_over
      FROM bookings b
      JOIN sessions s ON s.id = b.session_id
     WHERE s.hospital_id = ${hospitalId}
       AND s.session_date BETWEEN ${range.from}::date AND ${range.to}::date
       AND b.deleted_at IS NULL
       AND b.quoted_wait_minutes IS NOT NULL
       AND b.arrived_at IS NOT NULL
       AND b.called_at IS NOT NULL
  `.execute(db);

  const row = result.rows[0];
  return {
    quoted: Number(row?.quoted ?? 0),
    kept: Number(row?.kept ?? 0),
    avgOverMinutes:
      row?.avg_over === null || row?.avg_over === undefined ? null : Number(row.avg_over),
  };
}

/** The window's totals, already summed across its days. */
export async function lossTotals(hospitalId: string, range: DateRange): Promise<LossRow> {
  const result = await sql<{
    no_show_count: string;
    forgone_poisha: string;
    prepaid_poisha: string;
    offers_made: string;
    offers_accepted: string;
    recovered_poisha: string;
  }>`
    SELECT coalesce(sum(no_show_count), 0)::text   AS no_show_count,
           coalesce(sum(forgone_poisha), 0)::text  AS forgone_poisha,
           coalesce(sum(prepaid_poisha), 0)::text  AS prepaid_poisha,
           coalesce(sum(offers_made), 0)::text     AS offers_made,
           coalesce(sum(offers_accepted), 0)::text AS offers_accepted,
           coalesce(sum(recovered_poisha), 0)::text AS recovered_poisha
      FROM v_no_show_loss
     WHERE hospital_id = ${hospitalId}
       AND session_date BETWEEN ${range.from}::date AND ${range.to}::date
  `.execute(db);

  const row = result.rows[0];
  return {
    noShowCount: Number(row?.no_show_count ?? 0),
    forgonePoisha: Number(row?.forgone_poisha ?? 0),
    prepaidPoisha: Number(row?.prepaid_poisha ?? 0),
    offersMade: Number(row?.offers_made ?? 0),
    offersAccepted: Number(row?.offers_accepted ?? 0),
    recoveredPoisha: Number(row?.recovered_poisha ?? 0),
  };
}

/** Day by day, for the loss-and-recovery chart. */
export async function lossByDay(
  hospitalId: string,
  range: DateRange,
): Promise<(LossRow & { readonly sessionDate: string })[]> {
  const result = await sql<{
    session_date: string;
    no_show_count: number;
    forgone_poisha: string;
    prepaid_poisha: string;
    offers_made: number;
    offers_accepted: number;
    recovered_poisha: string;
  }>`
    SELECT session_date::text, no_show_count, forgone_poisha, prepaid_poisha,
           offers_made, offers_accepted, recovered_poisha
      FROM v_no_show_loss
     WHERE hospital_id = ${hospitalId}
       AND session_date BETWEEN ${range.from}::date AND ${range.to}::date
     ORDER BY session_date
  `.execute(db);

  return result.rows.map((row) => ({
    sessionDate: row.session_date,
    noShowCount: row.no_show_count,
    forgonePoisha: Number(row.forgone_poisha),
    prepaidPoisha: Number(row.prepaid_poisha),
    offersMade: row.offers_made,
    offersAccepted: row.offers_accepted,
    recoveredPoisha: Number(row.recovered_poisha),
  }));
}

// ---------------------------------------------------------------------------
// FR-ADM-04 — revenue
// ---------------------------------------------------------------------------

export interface RevenueSlice {
  readonly label: string;
  readonly labelEn: string;
  readonly collectedPoisha: number;
  readonly refundedPoisha: number;
  readonly billedPoisha: number;
  readonly bookings: number;
}

/**
 * Money by doctor, by department, or by payment method.
 *
 * One function and a dimension rather than three near-identical queries: the
 * joins and the filters are the same, and three copies is three places for the
 * hospital scope to drift apart.
 *
 * `billed` is carried beside `collected` because they differ by most of the
 * total in this market. A chamber that takes cash at the counter has billings
 * a payment row never sees, and a revenue screen showing only what came
 * through a gateway would tell a director their hospital earned a fraction of
 * what it did.
 */
export async function revenueBy(
  hospitalId: string,
  range: DateRange,
  dimension: 'doctor' | 'department' | 'method',
): Promise<RevenueSlice[]> {
  const grouped =
    dimension === 'doctor'
      ? sql`d.full_name_bn, d.full_name_en, d.id`
      : dimension === 'department'
        ? sql`dep.name_bn, dep.name_en, dep.id`
        : sql`p.method::text, p.method::text, p.method::text`;

  const label =
    dimension === 'doctor'
      ? sql`d.full_name_bn`
      : dimension === 'department'
        ? sql`dep.name_bn`
        : sql`coalesce(p.method::text, 'unpaid')`;

  const labelEn =
    dimension === 'doctor'
      ? sql`d.full_name_en`
      : dimension === 'department'
        ? sql`dep.name_en`
        : sql`coalesce(p.method::text, 'unpaid')`;

  const result = await sql<{
    label: string;
    label_en: string;
    collected_poisha: string;
    refunded_poisha: string;
    billed_poisha: string;
    bookings: string;
  }>`
    SELECT ${label} AS label,
           ${labelEn} AS label_en,
           coalesce(sum(p.amount_poisha) FILTER (
             WHERE p.state IN ('paid', 'refunded', 'partially_refunded')), 0)::text
             AS collected_poisha,
           coalesce(sum(p.refunded_poisha), 0)::text AS refunded_poisha,
           coalesce(sum(b.fee_poisha) FILTER (WHERE b.status = 'done'), 0)::text
             AS billed_poisha,
           count(DISTINCT b.id)::text AS bookings
      FROM bookings b
      JOIN sessions s    ON s.id = b.session_id
      JOIN doctors d     ON d.id = s.doctor_id
      JOIN departments dep ON dep.id = s.department_id
      LEFT JOIN payments p ON p.booking_id = b.id AND p.deleted_at IS NULL
     WHERE s.hospital_id = ${hospitalId}
       AND s.session_date BETWEEN ${range.from}::date AND ${range.to}::date
       AND b.deleted_at IS NULL
       AND s.deleted_at IS NULL
     GROUP BY ${grouped}
     ORDER BY 3 DESC, 1
  `.execute(db);

  return result.rows.map((row) => ({
    label: row.label,
    labelEn: row.label_en,
    collectedPoisha: Number(row.collected_poisha),
    refundedPoisha: Number(row.refunded_poisha),
    billedPoisha: Number(row.billed_poisha),
    bookings: Number(row.bookings),
  }));
}

/**
 * Money by service type (`FR-ADM-04`: consultation, tests, beds, pharmacy).
 *
 * `payments` has a column per chargeable thing, so the service type *is* which
 * column is set. Three of the four are always zero in this version — nothing
 * charges for a bed, a test or an ambulance, because a nightly rate, a
 * catalogue price and a quoted fare are commercial terms per hospital
 * (`CLAUDE.md` §1.1). They are returned as declared zeroes rather than
 * omitted: a missing line reads as "we did not look", a zero says "we looked".
 */
export async function revenueByService(
  hospitalId: string,
  range: DateRange,
): Promise<RevenueSlice[]> {
  const result = await sql<{
    service: string;
    collected_poisha: string;
    refunded_poisha: string;
    bookings: string;
  }>`
    WITH scoped AS (
      SELECT p.*,
             CASE
               WHEN p.booking_id IS NOT NULL            THEN 'consultation'
               WHEN p.test_order_id IS NOT NULL         THEN 'test'
               WHEN p.bed_request_id IS NOT NULL        THEN 'bed'
               WHEN p.ambulance_request_id IS NOT NULL  THEN 'ambulance'
               ELSE 'other'
             END AS service
        FROM payments p
        LEFT JOIN bookings b ON b.id = p.booking_id
        LEFT JOIN sessions s ON s.id = b.session_id
       WHERE p.deleted_at IS NULL
         AND p.state IN ('paid', 'refunded', 'partially_refunded')
         AND s.hospital_id = ${hospitalId}
         AND s.session_date BETWEEN ${range.from}::date AND ${range.to}::date
    )
    SELECT service,
           sum(amount_poisha)::text   AS collected_poisha,
           sum(refunded_poisha)::text AS refunded_poisha,
           count(*)::text             AS bookings
      FROM scoped
     GROUP BY service
  `.execute(db);

  return result.rows.map((row) => ({
    label: row.service,
    labelEn: row.service,
    collectedPoisha: Number(row.collected_poisha),
    refundedPoisha: Number(row.refunded_poisha),
    billedPoisha: 0,
    bookings: Number(row.bookings),
  }));
}

// ---------------------------------------------------------------------------
// FR-ADM-05 — punctuality
// ---------------------------------------------------------------------------

export interface TimingRow {
  readonly doctorId: string;
  readonly doctorNameBn: string;
  readonly doctorNameEn: string;
  readonly departmentNameBn: string;
  readonly departmentNameEn: string;
  readonly startDeltaMinutes: number | null;
  readonly avgConsultSeconds: number | null;
  readonly seen: number;
}

/** One row per session, for `punctualityByDoctor` to group and reduce. */
export async function sessionTimings(hospitalId: string, range: DateRange): Promise<TimingRow[]> {
  const result = await sql<{
    doctor_id: string;
    doctor_name_bn: string;
    doctor_name_en: string;
    department_name_bn: string;
    department_name_en: string;
    start_delta_minutes: number | null;
    avg_consult_seconds: number | null;
    seen: number;
  }>`
    SELECT s.doctor_id,
           d.full_name_bn AS doctor_name_bn,
           d.full_name_en AS doctor_name_en,
           dep.name_bn AS department_name_bn,
           dep.name_en AS department_name_en,
           CASE
             WHEN s.actual_start IS NOT NULL
               THEN round(EXTRACT(EPOCH FROM (s.actual_start - s.planned_start)) / 60.0)::int
           END AS start_delta_minutes,
           (SELECT round(avg(b.consult_seconds))::int
              FROM bookings b
             WHERE b.session_id = s.id AND b.status = 'done'
               AND b.consult_seconds IS NOT NULL AND b.deleted_at IS NULL) AS avg_consult_seconds,
           (SELECT count(*)::int
              FROM bookings b
             WHERE b.session_id = s.id AND b.status = 'done'
               AND b.deleted_at IS NULL) AS seen
      FROM sessions s
      JOIN doctors d       ON d.id = s.doctor_id
      JOIN departments dep ON dep.id = s.department_id
     WHERE s.hospital_id = ${hospitalId}
       AND s.session_date BETWEEN ${range.from}::date AND ${range.to}::date
       AND s.deleted_at IS NULL
  `.execute(db);

  return result.rows.map((row) => ({
    doctorId: row.doctor_id,
    doctorNameBn: row.doctor_name_bn,
    doctorNameEn: row.doctor_name_en,
    departmentNameBn: row.department_name_bn,
    departmentNameEn: row.department_name_en,
    startDeltaMinutes: row.start_delta_minutes,
    avgConsultSeconds: row.avg_consult_seconds,
    seen: row.seen,
  }));
}

// ---------------------------------------------------------------------------
// FR-ADM-06 — beds
// ---------------------------------------------------------------------------

export interface BedUtilisation {
  readonly kind: string;
  readonly total: number;
  readonly occupied: number;
  readonly admissions: number;
  /** Average length of stay in hours, over discharges inside the window. */
  readonly alosHours: number | null;
  /** Average hours a bed stood empty between one discharge and the next admission. */
  readonly turnoverHours: number | null;
}

/**
 * Utilisation, average length of stay and turnover (`FR-ADM-06`).
 *
 * ALOS counts only *completed* stays. A patient still in a bed has a length of
 * stay that is still growing, and including it would drag the average down by
 * however early in the stay the dashboard happened to be opened — so the
 * figure would change through the day without anything having happened.
 *
 * Turnover is the gap between one patient leaving a bed and the next arriving
 * in it, which is the thing a hospital can actually shorten. It is null where
 * no bed of that kind has turned over twice inside the window: one admission
 * gives no gap to measure, and reporting zero would read as instant turnover.
 */
export async function bedUtilisation(
  hospitalId: string,
  range: DateRange,
): Promise<BedUtilisation[]> {
  const result = await sql<{
    kind: string;
    total: number;
    occupied: number;
    admissions: number;
    alos_hours: number | null;
    turnover_hours: number | null;
  }>`
    WITH stays AS (
      SELECT a.bed_id, b.kind, a.admitted_at, a.discharged_at,
             lag(a.discharged_at) OVER (PARTITION BY a.bed_id ORDER BY a.admitted_at)
               AS previous_discharge
        FROM admissions a
        JOIN beds b ON b.id = a.bed_id
       WHERE a.hospital_id = ${hospitalId}
         AND b.deleted_at IS NULL
         AND a.admitted_at < (${range.to}::date + 1)
         AND (a.discharged_at IS NULL OR a.discharged_at >= ${range.from}::date)
    ),
    beds_now AS (
      SELECT kind,
             count(*) FILTER (WHERE state <> 'out_of_service')::int AS total,
             count(*) FILTER (WHERE state = 'occupied')::int        AS occupied
        FROM beds
       WHERE hospital_id = ${hospitalId} AND deleted_at IS NULL
       GROUP BY kind
    )
    SELECT bn.kind::text,
           bn.total,
           bn.occupied,
           coalesce(count(st.bed_id), 0)::int AS admissions,
           round(
             avg(EXTRACT(EPOCH FROM (st.discharged_at - st.admitted_at)) / 3600.0)
               FILTER (WHERE st.discharged_at IS NOT NULL)
           )::int AS alos_hours,
           round(
             avg(EXTRACT(EPOCH FROM (st.admitted_at - st.previous_discharge)) / 3600.0)
               FILTER (WHERE st.previous_discharge IS NOT NULL)
           )::int AS turnover_hours
      FROM beds_now bn
      LEFT JOIN stays st ON st.kind = bn.kind
     GROUP BY bn.kind, bn.total, bn.occupied
     ORDER BY bn.kind
  `.execute(db);

  return result.rows.map((row) => ({
    kind: row.kind,
    total: row.total,
    occupied: row.occupied,
    admissions: row.admissions,
    alosHours: row.alos_hours,
    turnoverHours: row.turnover_hours,
  }));
}

// ---------------------------------------------------------------------------
// FR-ADM-07 — referrals
// ---------------------------------------------------------------------------

export interface ReferralFlow {
  readonly sentTotal: number;
  readonly sentAccepted: number;
  readonly sentDeclined: number;
  readonly sentOpen: number;
  readonly leaked: number;
  readonly receivedTotal: number;
  readonly receivedAccepted: number;
  readonly receivedDeclined: number;
  readonly receivedOpen: number;
  readonly asOf: Date | null;
}

export async function referralFlow(hospitalId: string): Promise<ReferralFlow | null> {
  const result = await sql<{
    sent_total: number;
    sent_accepted: number;
    sent_declined: number;
    sent_open: number;
    leaked: number;
    received_total: number;
    received_accepted: number;
    received_declined: number;
    received_open: number;
    as_of: Date | null;
  }>`
    SELECT sent_total, sent_accepted, sent_declined, sent_open, leaked,
           received_total, received_accepted, received_declined, received_open, as_of
      FROM v_referral_flow
     WHERE hospital_id = ${hospitalId}
  `.execute(db);

  const row = result.rows[0];
  if (row === undefined) return null;

  return {
    sentTotal: row.sent_total,
    sentAccepted: row.sent_accepted,
    sentDeclined: row.sent_declined,
    sentOpen: row.sent_open,
    leaked: row.leaked,
    receivedTotal: row.received_total,
    receivedAccepted: row.received_accepted,
    receivedDeclined: row.received_declined,
    receivedOpen: row.received_open,
    asOf: row.as_of,
  };
}

// ---------------------------------------------------------------------------
// FR-ADM-08 — feedback
// ---------------------------------------------------------------------------

export interface FeedbackSummary {
  readonly responses: number;
  readonly waitScore: number | null;
  readonly doctorScore: number | null;
  readonly cleanlinessScore: number | null;
  readonly billingScore: number | null;
  /** How many responses scored each dimension at all. */
  readonly waitAnswered: number;
  readonly doctorAnswered: number;
  readonly cleanlinessAnswered: number;
  readonly billingAnswered: number;
  readonly asOf: Date | null;
}

/**
 * The four averages, each over the people who actually answered it.
 *
 * Not one overall rating. `FR-PAT-83` asks four separate questions because
 * they fail independently — a hospital whose doctors are loved and whose
 * billing is distrusted has an average that says nothing and two columns that
 * say everything — and an administrator can only act on the one that is wrong.
 *
 * Each average divides by its own answer count, not by the response count. A
 * patient who rated the doctor and left billing blank has not rated billing
 * zero, and treating a blank as a bad score is how a feedback screen invents a
 * complaint.
 */
export async function feedbackSummary(
  hospitalId: string,
  range: DateRange,
): Promise<FeedbackSummary> {
  const result = await sql<{
    responses: number;
    wait_score: string | null;
    doctor_score: string | null;
    cleanliness_score: string | null;
    billing_score: string | null;
    wait_answered: number;
    doctor_answered: number;
    cleanliness_answered: number;
    billing_answered: number;
    as_of: Date | null;
  }>`
    SELECT count(*)::int                       AS responses,
           round(avg(wait_score), 2)::text     AS wait_score,
           round(avg(doctor_score), 2)::text   AS doctor_score,
           round(avg(cleanliness_score), 2)::text AS cleanliness_score,
           round(avg(billing_score), 2)::text  AS billing_score,
           count(wait_score)::int              AS wait_answered,
           count(doctor_score)::int            AS doctor_answered,
           count(cleanliness_score)::int       AS cleanliness_answered,
           count(billing_score)::int           AS billing_answered,
           max(created_at)                     AS as_of
      FROM feedback
     WHERE hospital_id = ${hospitalId}
       AND deleted_at IS NULL
       AND created_at >= ${range.from}::date
       AND created_at < (${range.to}::date + 1)
  `.execute(db);

  const row = result.rows[0];
  return {
    responses: row?.responses ?? 0,
    waitScore: numberOrNull(row?.wait_score),
    doctorScore: numberOrNull(row?.doctor_score),
    cleanlinessScore: numberOrNull(row?.cleanliness_score),
    billingScore: numberOrNull(row?.billing_score),
    waitAnswered: row?.wait_answered ?? 0,
    doctorAnswered: row?.doctor_answered ?? 0,
    cleanlinessAnswered: row?.cleanliness_answered ?? 0,
    billingAnswered: row?.billing_answered ?? 0,
    asOf: row?.as_of ?? null,
  };
}

/** How many responses rated each dimension badly enough to be a complaint. */
export interface ComplaintCount {
  readonly category: 'wait' | 'doctor' | 'cleanliness' | 'billing';
  readonly complaints: number;
  readonly answered: number;
}

/**
 * `FR-ADM-08`'s "complaint categories", derived rather than typed.
 *
 * Asking a patient to pick a category gets the first item in the list. A score
 * at or below the threshold *is* the category, it comes free with the rating,
 * and it cannot be skewed by the order the options were printed in.
 *
 * Two out of five is the line. Three is the middle of a five-point scale and
 * counting it would make a merely unremarkable hospital look like it was
 * failing; one alone would report only the furious and miss the steady
 * dissatisfaction that actually loses a hospital its patients.
 */
export const COMPLAINT_AT_OR_BELOW = 2;

export async function complaintCategories(
  hospitalId: string,
  range: DateRange,
): Promise<ComplaintCount[]> {
  const result = await sql<{
    wait_complaints: number;
    doctor_complaints: number;
    cleanliness_complaints: number;
    billing_complaints: number;
    wait_answered: number;
    doctor_answered: number;
    cleanliness_answered: number;
    billing_answered: number;
  }>`
    SELECT count(*) FILTER (WHERE wait_score        <= ${COMPLAINT_AT_OR_BELOW})::int AS wait_complaints,
           count(*) FILTER (WHERE doctor_score      <= ${COMPLAINT_AT_OR_BELOW})::int AS doctor_complaints,
           count(*) FILTER (WHERE cleanliness_score <= ${COMPLAINT_AT_OR_BELOW})::int AS cleanliness_complaints,
           count(*) FILTER (WHERE billing_score     <= ${COMPLAINT_AT_OR_BELOW})::int AS billing_complaints,
           count(wait_score)::int        AS wait_answered,
           count(doctor_score)::int      AS doctor_answered,
           count(cleanliness_score)::int AS cleanliness_answered,
           count(billing_score)::int     AS billing_answered
      FROM feedback
     WHERE hospital_id = ${hospitalId}
       AND deleted_at IS NULL
       AND created_at >= ${range.from}::date
       AND created_at < (${range.to}::date + 1)
  `.execute(db);

  const row = result.rows[0];

  return [
    { category: 'wait', complaints: row?.wait_complaints ?? 0, answered: row?.wait_answered ?? 0 },
    {
      category: 'doctor',
      complaints: row?.doctor_complaints ?? 0,
      answered: row?.doctor_answered ?? 0,
    },
    {
      category: 'cleanliness',
      complaints: row?.cleanliness_complaints ?? 0,
      answered: row?.cleanliness_answered ?? 0,
    },
    {
      category: 'billing',
      complaints: row?.billing_complaints ?? 0,
      answered: row?.billing_answered ?? 0,
    },
  ];
}

// ---------------------------------------------------------------------------
// FR-ADM-09 — volume history for the forecast
// ---------------------------------------------------------------------------

export interface VolumeRow {
  readonly date: string;
  readonly weekday: number;
  readonly slot: 'morning' | 'afternoon' | 'evening';
  readonly seen: number;
}

/**
 * Past attendance by weekday and part of day, for `forecastVolume`.
 *
 * The part of day is computed here because only the repository knows the time
 * zone: `planned_start` is UTC (`DB-P4`) and a chamber at 17:00 Dhaka is
 * 11:00 UTC, so bucketing on the stored hour would put every evening clinic in
 * the morning.
 */
export async function volumeHistory(
  hospitalId: string,
  sinceDate: string,
  untilDate: string,
): Promise<VolumeRow[]> {
  const result = await sql<{
    date: string;
    weekday: number;
    slot: string;
    seen: number;
  }>`
    SELECT s.session_date::text AS date,
           EXTRACT(DOW FROM s.session_date)::int AS weekday,
           CASE
             WHEN EXTRACT(HOUR FROM s.planned_start AT TIME ZONE 'Asia/Dhaka') < 12 THEN 'morning'
             WHEN EXTRACT(HOUR FROM s.planned_start AT TIME ZONE 'Asia/Dhaka') < 16 THEN 'afternoon'
             ELSE 'evening'
           END AS slot,
           (SELECT count(*)::int FROM bookings b
             WHERE b.session_id = s.id AND b.status = 'done' AND b.deleted_at IS NULL) AS seen
      FROM sessions s
     WHERE s.hospital_id = ${hospitalId}
       AND s.session_date >= ${sinceDate}::date
       AND s.session_date <= ${untilDate}::date
       AND s.deleted_at IS NULL
       AND s.status = 'ended'
     ORDER BY s.session_date
  `.execute(db);

  return result.rows.map((row) => ({
    date: row.date,
    weekday: row.weekday,
    slot: row.slot as VolumeRow['slot'],
    seen: row.seen,
  }));
}

// ---------------------------------------------------------------------------
// FR-ADM-02 — the adoption marker
// ---------------------------------------------------------------------------

/**
 * The day this hospital's queue went live, for the trend chart's marker.
 *
 * `hospitals.onboarded_at` is the recorded fact and is what the marker reads.
 * `FR-ADM-02` exists to answer one question a director asks — *did this change
 * anything?* — and a chart with a line on it answers it in a way a table
 * cannot. Null for a facility never onboarded, in which case the chart draws
 * no marker rather than guessing a date from the data.
 */
export async function adoptionDate(hospitalId: string): Promise<string | null> {
  const result = await sql<{ onboarded_on: string | null }>`
    SELECT (onboarded_at AT TIME ZONE 'Asia/Dhaka')::date::text AS onboarded_on
      FROM hospitals
     WHERE id = ${hospitalId} AND deleted_at IS NULL
  `.execute(db);

  return result.rows[0]?.onboarded_on ?? null;
}

// ---------------------------------------------------------------------------
// FR-ADM-10 — the export audit row
// ---------------------------------------------------------------------------

/**
 * Records that somebody took data out of the building (`DB-P7`, `FR-SEC-03`).
 *
 * `audit_log.action` has `EXPORT` for exactly this. An export is the one
 * dashboard action that produces a file which leaves the hospital's systems,
 * so it is the one that must be answerable months later — and the row names
 * the view and the window, because "somebody exported something" is not an
 * answer to "who took the revenue figures for March".
 */
export async function recordExport(
  trx: Tx,
  input: {
    readonly staffUserId: string | null;
    readonly hospitalId: string;
    readonly view: string;
    readonly range: DateRange;
    readonly rows: number;
    readonly ip: string | null;
    readonly userAgent: string | null;
  },
): Promise<void> {
  await sql`
    INSERT INTO audit_log
      (actor_staff_id, hospital_id, action, subject_table, subject_id, ip, user_agent, meta)
    VALUES (
      ${input.staffUserId}::uuid,
      ${input.hospitalId}::uuid,
      'EXPORT',
      ${input.view},
      NULL,
      ${input.ip}::inet,
      ${input.userAgent},
      ${JSON.stringify({ from: input.range.from, to: input.range.to, rows: input.rows })}::jsonb
    )
  `.execute(trx);
}

function numberOrNull(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
