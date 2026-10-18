"""The administrator's figures (port of `repositories/admin.repo.ts`; FR-ADM-*).

Figures that Postgres returns as numeric or bigint arrive as text, exactly as
the Node driver hands them over; `_number` is JavaScript's `Number()` for the
places the Node code converts them.
"""

from __future__ import annotations

import json
import math
from datetime import datetime
from typing import Any

from ..core import db

COMPLAINT_AT_OR_BELOW = 2


def _number(value: Any) -> int | float:
    """`Number(value)` for the text Postgres gives back."""
    if value is None:
        return 0
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    text = str(value).strip()
    if text == "":
        return 0
    try:
        return int(text)
    except ValueError:
        try:
            parsed = float(text)
        except ValueError:
            return math.nan
        return int(parsed) if parsed.is_integer() else parsed


def _number_or_null(value: Any) -> int | float | None:
    if value is None:
        return None
    parsed = _number(value)
    return parsed if isinstance(parsed, int) or math.isfinite(parsed) else None


def _or0(value: Any) -> Any:
    return 0 if value is None else value


def daily_rows(hospital_id: str, date_from: str, date_to: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT session_date::text, seen, no_shows, cancelled, booked_total,
               walkin_count, booked_count, avg_wait_minutes, longest_wait_minutes,
               waits_measured, avg_overrun_minutes, longest_overrun_minutes,
               overruns_measured, avg_consult_seconds, sessions_total,
               sessions_never_started, avg_start_delta_minutes, sessions_late,
               collected_poisha, refunded_poisha, billed_poisha
          FROM v_admin_daily
         WHERE hospital_id = %s
           AND session_date BETWEEN %s::date AND %s::date
         ORDER BY session_date
        """,
        [hospital_id, date_from, date_to],
    )
    return [
        {
            "sessionDate": r["session_date"],
            "seen": r["seen"],
            "noShows": r["no_shows"],
            "cancelled": r["cancelled"],
            "bookedTotal": r["booked_total"],
            "walkinCount": r["walkin_count"],
            "bookedCount": r["booked_count"],
            "avgWaitMinutes": r["avg_wait_minutes"],
            "longestWaitMinutes": r["longest_wait_minutes"],
            "waitsMeasured": r["waits_measured"],
            "avgOverrunMinutes": r["avg_overrun_minutes"],
            "longestOverrunMinutes": r["longest_overrun_minutes"],
            "overrunsMeasured": r["overruns_measured"],
            "avgConsultSeconds": r["avg_consult_seconds"],
            "sessionsTotal": r["sessions_total"],
            "sessionsNeverStarted": r["sessions_never_started"],
            "avgStartDeltaMinutes": r["avg_start_delta_minutes"],
            "sessionsLate": r["sessions_late"],
            "collectedPoisha": _number(r["collected_poisha"]),
            "refundedPoisha": _number(r["refunded_poisha"]),
            "billedPoisha": _number(r["billed_poisha"]),
        }
        for r in rows
    ]


def daily_refreshed_at() -> datetime | None:
    return db.fetch_value("SELECT refreshed_at FROM analytics_refresh WHERE view_name = 'v_admin_daily'")


def refresh_daily() -> datetime:
    db.execute("SELECT fn_refresh_admin_daily()")
    stamped = db.fetch_value(
        """
        INSERT INTO analytics_refresh (view_name, refreshed_at)
        VALUES ('v_admin_daily', now())
        ON CONFLICT (view_name) DO UPDATE SET refreshed_at = now()
        RETURNING refreshed_at
        """
    )
    if stamped is None:
        raise RuntimeError("analytics_refresh returned no stamp.")
    return stamped


def quote_counts(hospital_id: str, date_from: str, date_to: str, tolerance_minutes: int) -> dict[str, Any]:
    row = db.fetch_one(
        """
        SELECT count(*)::text AS quoted,
               count(*) FILTER (
                 WHERE b.called_at <= b.arrived_at
                       + make_interval(mins => b.quoted_wait_minutes + %s)
               )::text AS kept,
               avg(EXTRACT(EPOCH FROM (b.called_at - b.arrived_at)) / 60.0
                   - b.quoted_wait_minutes)::text AS avg_over
          FROM bookings b
          JOIN sessions s ON s.id = b.session_id
         WHERE s.hospital_id = %s
           AND s.session_date BETWEEN %s::date AND %s::date
           AND b.deleted_at IS NULL
           AND b.quoted_wait_minutes IS NOT NULL
           AND b.arrived_at IS NOT NULL
           AND b.called_at IS NOT NULL
        """,
        [tolerance_minutes, hospital_id, date_from, date_to],
    )
    row = row or {}
    return {
        "quoted": _number(row.get("quoted")),
        "kept": _number(row.get("kept")),
        "avgOverMinutes": None if row.get("avg_over") is None else _number(row["avg_over"]),
    }


def loss_totals(hospital_id: str, date_from: str, date_to: str) -> dict[str, Any]:
    row = db.fetch_one(
        """
        SELECT coalesce(sum(no_show_count), 0)::text   AS no_show_count,
               coalesce(sum(forgone_poisha), 0)::text  AS forgone_poisha,
               coalesce(sum(prepaid_poisha), 0)::text  AS prepaid_poisha,
               coalesce(sum(offers_made), 0)::text     AS offers_made,
               coalesce(sum(offers_accepted), 0)::text AS offers_accepted,
               coalesce(sum(recovered_poisha), 0)::text AS recovered_poisha
          FROM v_no_show_loss
         WHERE hospital_id = %s
           AND session_date BETWEEN %s::date AND %s::date
        """,
        [hospital_id, date_from, date_to],
    )
    row = row or {}
    return {
        "noShowCount": _number(row.get("no_show_count")),
        "forgonePoisha": _number(row.get("forgone_poisha")),
        "prepaidPoisha": _number(row.get("prepaid_poisha")),
        "offersMade": _number(row.get("offers_made")),
        "offersAccepted": _number(row.get("offers_accepted")),
        "recoveredPoisha": _number(row.get("recovered_poisha")),
    }


def loss_by_day(hospital_id: str, date_from: str, date_to: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT session_date::text, no_show_count, forgone_poisha, prepaid_poisha,
               offers_made, offers_accepted, recovered_poisha
          FROM v_no_show_loss
         WHERE hospital_id = %s
           AND session_date BETWEEN %s::date AND %s::date
         ORDER BY session_date
        """,
        [hospital_id, date_from, date_to],
    )
    return [
        {
            "sessionDate": r["session_date"],
            "noShowCount": r["no_show_count"],
            "forgonePoisha": _number(r["forgone_poisha"]),
            "prepaidPoisha": _number(r["prepaid_poisha"]),
            "offersMade": r["offers_made"],
            "offersAccepted": r["offers_accepted"],
            "recoveredPoisha": _number(r["recovered_poisha"]),
        }
        for r in rows
    ]


_REVENUE_DIMENSIONS = {
    "doctor": ("d.full_name_bn, d.full_name_en, d.id", "d.full_name_bn", "d.full_name_en"),
    "department": ("dep.name_bn, dep.name_en, dep.id", "dep.name_bn", "dep.name_en"),
    "method": (
        "p.method::text, p.method::text, p.method::text",
        "coalesce(p.method::text, 'unpaid')",
        "coalesce(p.method::text, 'unpaid')",
    ),
}


def revenue_by(hospital_id: str, date_from: str, date_to: str, dimension: str) -> list[dict[str, Any]]:
    grouped, label, label_en = _REVENUE_DIMENSIONS[dimension]
    rows = db.fetch_all(
        f"""
        SELECT {label} AS label,
               {label_en} AS label_en,
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
         WHERE s.hospital_id = %s
           AND s.session_date BETWEEN %s::date AND %s::date
           AND b.deleted_at IS NULL
           AND s.deleted_at IS NULL
         GROUP BY {grouped}
         ORDER BY 3 DESC, 1
        """,
        [hospital_id, date_from, date_to],
    )
    return [
        {
            "label": r["label"],
            "labelEn": r["label_en"],
            "collectedPoisha": _number(r["collected_poisha"]),
            "refundedPoisha": _number(r["refunded_poisha"]),
            "billedPoisha": _number(r["billed_poisha"]),
            "bookings": _number(r["bookings"]),
        }
        for r in rows
    ]


def revenue_by_service(hospital_id: str, date_from: str, date_to: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
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
             AND s.hospital_id = %s
             AND s.session_date BETWEEN %s::date AND %s::date
        )
        SELECT service,
               sum(amount_poisha)::text   AS collected_poisha,
               sum(refunded_poisha)::text AS refunded_poisha,
               count(*)::text             AS bookings
          FROM scoped
         GROUP BY service
        """,
        [hospital_id, date_from, date_to],
    )
    return [
        {
            "label": r["service"],
            "labelEn": r["service"],
            "collectedPoisha": _number(r["collected_poisha"]),
            "refundedPoisha": _number(r["refunded_poisha"]),
            "billedPoisha": 0,
            "bookings": _number(r["bookings"]),
        }
        for r in rows
    ]


def session_timings(hospital_id: str, date_from: str, date_to: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
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
         WHERE s.hospital_id = %s
           AND s.session_date BETWEEN %s::date AND %s::date
           AND s.deleted_at IS NULL
        """,
        [hospital_id, date_from, date_to],
    )
    return [
        {
            "doctorId": r["doctor_id"],
            "doctorNameBn": r["doctor_name_bn"],
            "doctorNameEn": r["doctor_name_en"],
            "departmentNameBn": r["department_name_bn"],
            "departmentNameEn": r["department_name_en"],
            "startDeltaMinutes": r["start_delta_minutes"],
            "avgConsultSeconds": r["avg_consult_seconds"],
            "seen": r["seen"],
        }
        for r in rows
    ]


def bed_utilisation(hospital_id: str, date_from: str, date_to: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        WITH stays AS (
          SELECT a.bed_id, b.kind, a.admitted_at, a.discharged_at,
                 lag(a.discharged_at) OVER (PARTITION BY a.bed_id ORDER BY a.admitted_at)
                   AS previous_discharge
            FROM admissions a
            JOIN beds b ON b.id = a.bed_id
           WHERE a.hospital_id = %(h)s
             AND b.deleted_at IS NULL
             AND a.admitted_at < (%(to)s::date + 1)
             AND (a.discharged_at IS NULL OR a.discharged_at >= %(from)s::date)
        ),
        beds_now AS (
          SELECT kind,
                 count(*) FILTER (WHERE state <> 'out_of_service')::int AS total,
                 count(*) FILTER (WHERE state = 'occupied')::int        AS occupied
            FROM beds
           WHERE hospital_id = %(h)s AND deleted_at IS NULL
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
        """,
        {"h": hospital_id, "from": date_from, "to": date_to},
    )
    return [
        {
            "kind": r["kind"],
            "total": r["total"],
            "occupied": r["occupied"],
            "admissions": r["admissions"],
            "alosHours": r["alos_hours"],
            "turnoverHours": r["turnover_hours"],
        }
        for r in rows
    ]


def referral_flow(hospital_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT sent_total, sent_accepted, sent_declined, sent_open, leaked,
               received_total, received_accepted, received_declined, received_open, as_of
          FROM v_referral_flow
         WHERE hospital_id = %s
        """,
        [hospital_id],
    )
    if row is None:
        return None
    return {
        "sentTotal": row["sent_total"],
        "sentAccepted": row["sent_accepted"],
        "sentDeclined": row["sent_declined"],
        "sentOpen": row["sent_open"],
        "leaked": row["leaked"],
        "receivedTotal": row["received_total"],
        "receivedAccepted": row["received_accepted"],
        "receivedDeclined": row["received_declined"],
        "receivedOpen": row["received_open"],
        # A datetime, as Node's is a Date: the service stamps it.
        "asOf": row["as_of"],
    }


def feedback_summary(hospital_id: str, date_from: str, date_to: str) -> dict[str, Any]:
    row = db.fetch_one(
        """
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
         WHERE hospital_id = %(h)s
           AND deleted_at IS NULL
           AND created_at >= %(from)s::date
           AND created_at < (%(to)s::date + 1)
        """,
        {"h": hospital_id, "from": date_from, "to": date_to},
    )
    row = row or {}
    return {
        "responses": _or0(row.get("responses")),
        "waitScore": _number_or_null(row.get("wait_score")),
        "doctorScore": _number_or_null(row.get("doctor_score")),
        "cleanlinessScore": _number_or_null(row.get("cleanliness_score")),
        "billingScore": _number_or_null(row.get("billing_score")),
        "waitAnswered": _or0(row.get("wait_answered")),
        "doctorAnswered": _or0(row.get("doctor_answered")),
        "cleanlinessAnswered": _or0(row.get("cleanliness_answered")),
        "billingAnswered": _or0(row.get("billing_answered")),
        "asOf": row.get("as_of"),
    }


def complaint_categories(hospital_id: str, date_from: str, date_to: str) -> list[dict[str, Any]]:
    row = db.fetch_one(
        """
        SELECT count(*) FILTER (WHERE wait_score        <= %(at)s)::int AS wait_complaints,
               count(*) FILTER (WHERE doctor_score      <= %(at)s)::int AS doctor_complaints,
               count(*) FILTER (WHERE cleanliness_score <= %(at)s)::int AS cleanliness_complaints,
               count(*) FILTER (WHERE billing_score     <= %(at)s)::int AS billing_complaints,
               count(wait_score)::int        AS wait_answered,
               count(doctor_score)::int      AS doctor_answered,
               count(cleanliness_score)::int AS cleanliness_answered,
               count(billing_score)::int     AS billing_answered
          FROM feedback
         WHERE hospital_id = %(h)s
           AND deleted_at IS NULL
           AND created_at >= %(from)s::date
           AND created_at < (%(to)s::date + 1)
        """,
        {"at": COMPLAINT_AT_OR_BELOW, "h": hospital_id, "from": date_from, "to": date_to},
    )
    row = row or {}
    return [
        {
            "category": category,
            "complaints": _or0(row.get(f"{category}_complaints")),
            "answered": _or0(row.get(f"{category}_answered")),
        }
        for category in ("wait", "doctor", "cleanliness", "billing")
    ]


def volume_history(hospital_id: str, since_date: str, until_date: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
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
         WHERE s.hospital_id = %s
           AND s.session_date >= %s::date
           AND s.session_date <= %s::date
           AND s.deleted_at IS NULL
           AND s.status = 'ended'
         ORDER BY s.session_date
        """,
        [hospital_id, since_date, until_date],
    )
    return [{"date": r["date"], "weekday": r["weekday"], "slot": r["slot"], "seen": r["seen"]} for r in rows]


def adoption_date(hospital_id: str) -> str | None:
    return db.fetch_value(
        """
        SELECT (onboarded_at AT TIME ZONE 'Asia/Dhaka')::date::text AS onboarded_on
          FROM hospitals
         WHERE id = %s AND deleted_at IS NULL
        """,
        [hospital_id],
    )


def record_export(
    *,
    staff_user_id: str | None,
    hospital_id: str,
    view: str,
    date_from: str,
    date_to: str,
    rows: int,
    ip: str | None,
    user_agent: str | None,
) -> None:
    db.execute(
        """
        INSERT INTO audit_log
          (actor_staff_id, hospital_id, action, subject_table, subject_id, ip, user_agent, meta)
        VALUES (%s::uuid, %s::uuid, 'EXPORT', %s, NULL, %s::inet, %s, %s::jsonb)
        """,
        [
            staff_user_id,
            hospital_id,
            view,
            ip,
            user_agent,
            json.dumps({"from": date_from, "to": date_to, "rows": rows}, separators=(",", ":")),
        ],
    )


def overview_today(*, hospital_id: str, date: str, on_the_way: list[str], in_er: list[str]) -> dict[str, Any]:
    row = db.fetch_one(
        """
        WITH today AS (
          SELECT s.id, s.doctor_id, s.status
            FROM sessions s
           WHERE s.hospital_id = %(h)s::uuid
             AND s.session_date = %(date)s::date
             AND s.deleted_at IS NULL
             AND s.status <> 'cancelled'
        )
        SELECT
          (SELECT count(DISTINCT doctor_id) FROM today)::int AS doctors_scheduled,
          (SELECT count(DISTINCT doctor_id) FROM today
            WHERE status IN ('running', 'paused'))::int AS doctors_sitting,
          (SELECT coalesce(sum(c.waiting), 0) FROM today t, fn_chamber_counts(t.id) c
            WHERE t.status <> 'ended')::int AS waiting,
          (SELECT count(*) FROM bookings b JOIN today t ON t.id = b.session_id
            WHERE b.deleted_at IS NULL AND b.status <> 'cancelled')::int AS appointments,
          (SELECT count(*) FROM bookings b JOIN today t ON t.id = b.session_id
            WHERE b.deleted_at IS NULL AND b.status = 'done')::int AS seen,
          fn_module_on(%(h)s::uuid, 'emergency') AS emergency_on,
          (SELECT count(*) FROM emergency_cases e
            WHERE e.hospital_id = %(h)s::uuid AND e.deleted_at IS NULL
              AND e.state::text = ANY(%(way)s::text[]))::int AS on_the_way,
          (SELECT count(*) FROM emergency_cases e
            WHERE e.hospital_id = %(h)s::uuid AND e.deleted_at IS NULL
              AND e.state::text = ANY(%(er)s::text[]))::int AS in_er,
          fn_module_on(%(h)s::uuid, 'beds') AS beds_on
        """,
        {"h": hospital_id, "date": date, "way": list(on_the_way), "er": list(in_er)},
    )
    if row is None:
        raise RuntimeError("overview returned no row.")
    return {
        "doctorsScheduled": row["doctors_scheduled"],
        "doctorsSitting": row["doctors_sitting"],
        "waiting": row["waiting"],
        "appointments": row["appointments"],
        "seen": row["seen"],
        "emergency": {"onTheWay": row["on_the_way"], "inEr": row["in_er"]} if row["emergency_on"] else None,
        "bedsOn": row["beds_on"],
    }
