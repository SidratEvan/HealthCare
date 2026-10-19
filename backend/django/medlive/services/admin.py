"""The hospital administrator's dashboard and export (port of `services/admin.service.ts`; S-B-10, FR-ADM-01..12).

Every figure carries its own age: the snapshot's, the referral view's and the
feedback's, reported apart (PRD.md §3.2). A read rebuilds `v_admin_daily`
when it is older than five minutes; a rebuild that fails serves the older
snapshot with its true age rather than an error. A figure nothing measured
is null, never zero.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from ..core import db
from ..core.errors import AppError
from ..core.logging import logger
from ..domain.admin.forecast import forecast_volume
from ..domain.admin.punctuality import punctuality_by_doctor
from ..domain.admin.quotes import QUOTE_TOLERANCE_MINUTES, quote_accuracy
from ..domain.admin.recovery import loss_and_recovery
from ..domain.emergency.cases import IN_ER_STATES, ON_THE_WAY_STATES
from ..domain.jsfmt import js_str
from ..domain.time import from_datetime, js_round, now_iso, now_ms, parse_ms, to_dhaka_date
from ..repositories import admin as admin_repo
from ..repositories import bed as bed_repo
from ..repositories.admin_chambers import chambers_today

SNAPSHOT_MAX_AGE_MS = 5 * 60_000
FORECAST_HISTORY_DAYS = 84
MAX_RANGE_DAYS = 400

_DATE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}\Z")


def valid_range(date_from: str, date_to: str) -> dict[str, str]:
    if not _DATE.match(date_from) or not _DATE.match(date_to):
        raise AppError(
            "VALIDATION_FAILED",
            message="A date range is two calendar dates, as YYYY-MM-DD.",
            details={"from": date_from, "to": date_to},
        )
    if date_from > date_to:
        raise AppError("VALIDATION_FAILED", message="The range starts after it ends.", details={"from": date_from, "to": date_to})
    days = js_round((parse_ms(f"{date_to}T00:00:00Z") - parse_ms(f"{date_from}T00:00:00Z")) / 86_400_000)
    if days > MAX_RANGE_DAYS:
        raise AppError(
            "VALIDATION_FAILED",
            message=f"A dashboard range covers at most {MAX_RANGE_DAYS} days.",
            details={"days": days},
        )
    return {"from": date_from, "to": date_to}


def _ensure_fresh() -> datetime | None:
    current = admin_repo.daily_refreshed_at()
    age = float("inf") if current is None else now_ms() - current.timestamp() * 1000
    if age < SNAPSHOT_MAX_AGE_MS:
        return current
    try:
        return admin_repo.refresh_daily()
    except Exception as cause:
        logger.warn({"err": cause}, "could not refresh v_admin_daily; serving the older snapshot")
        return current


def _total(rows: list[dict[str, Any]], key: str) -> Any:
    return sum(row[key] for row in rows)


def _totals_of(daily: list[dict[str, Any]]) -> dict[str, Any]:
    measured = _total(daily, "waitsMeasured")
    waited_minutes = sum((row["avgWaitMinutes"] or 0) * row["waitsMeasured"] for row in daily)
    overruns = _total(daily, "overrunsMeasured")
    overrun_minutes = sum((row["avgOverrunMinutes"] or 0) * row["overrunsMeasured"] for row in daily)
    longest_values = [row["longestWaitMinutes"] for row in daily if row["longestWaitMinutes"] is not None]
    overrun_values = [row["longestOverrunMinutes"] for row in daily if row["longestOverrunMinutes"] is not None]
    return {
        "seen": _total(daily, "seen"),
        "booked": _total(daily, "bookedTotal"),
        "noShows": _total(daily, "noShows"),
        "cancelled": _total(daily, "cancelled"),
        "walkin": _total(daily, "walkinCount"),
        "bookedAhead": _total(daily, "bookedCount"),
        "avgWaitMinutes": None if measured == 0 else js_round(waited_minutes / measured),
        "longestWaitMinutes": max(longest_values) if longest_values else None,
        "waitsMeasured": measured,
        "avgOverrunMinutes": None if overruns == 0 else js_round(overrun_minutes / overruns),
        "longestOverrunMinutes": max(overrun_values) if overrun_values else None,
        "overrunsMeasured": overruns,
        "sessionsTotal": _total(daily, "sessionsTotal"),
        "sessionsLate": _total(daily, "sessionsLate"),
        "sessionsNeverStarted": _total(daily, "sessionsNeverStarted"),
    }


SERVICE_TYPES = ("consultation", "test", "bed", "ambulance")


def _with_declared_zeroes(slices: list[dict[str, Any]]) -> list[dict[str, Any]]:
    found = {slice_["label"]: slice_ for slice_ in slices}
    return [
        found.get(service)
        or {
            "label": service,
            "labelEn": service,
            "collectedPoisha": 0,
            "refundedPoisha": 0,
            "billedPoisha": 0,
            "bookings": 0,
        }
        for service in SERVICE_TYPES
    ]


def _days_before(date: str, days: int) -> str:
    at = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc) - timedelta(days=days)
    return at.strftime("%Y-%m-%d")


def _iso_or_none(value: datetime | None) -> str | None:
    return None if value is None else from_datetime(value)


def dashboard(*, hospital_id: str, date_from: str, date_to: str) -> dict[str, Any]:
    range_ = valid_range(date_from, date_to)
    snapshot_at = _ensure_fresh()
    f, t = range_["from"], range_["to"]
    daily = admin_repo.daily_rows(hospital_id, f, t)
    loss_totals = admin_repo.loss_totals(hospital_id, f, t)
    loss_days = admin_repo.loss_by_day(hospital_id, f, t)
    by_doctor = admin_repo.revenue_by(hospital_id, f, t, "doctor")
    by_department = admin_repo.revenue_by(hospital_id, f, t, "department")
    by_method = admin_repo.revenue_by(hospital_id, f, t, "method")
    by_service = admin_repo.revenue_by_service(hospital_id, f, t)
    timings = admin_repo.session_timings(hospital_id, f, t)
    beds = admin_repo.bed_utilisation(hospital_id, f, t)
    referrals = admin_repo.referral_flow(hospital_id)
    feedback_summary = admin_repo.feedback_summary(hospital_id, f, t)
    complaints = admin_repo.complaint_categories(hospital_id, f, t)
    adoption = admin_repo.adoption_date(hospital_id)
    history = admin_repo.volume_history(hospital_id, _days_before(t, FORECAST_HISTORY_DAYS), t)
    quotes = admin_repo.quote_counts(hospital_id, f, t, QUOTE_TOLERANCE_MINUTES)

    loss = loss_and_recovery(
        {
            "count": loss_totals["noShowCount"],
            "forgonePoisha": loss_totals["forgonePoisha"],
            "prepaidPoisha": loss_totals["prepaidPoisha"],
        },
        {
            "offered": loss_totals["offersMade"],
            "accepted": loss_totals["offersAccepted"],
            "recoveredPoisha": loss_totals["recoveredPoisha"],
        },
    )
    referrals_view = None
    if referrals is not None:
        referrals_view = {**referrals, "asOf": _iso_or_none(referrals["asOf"])}
    feedback_view = {**feedback_summary, "asOf": _iso_or_none(feedback_summary["asOf"])}
    return {
        "range": range_,
        "today": _totals_of(daily),
        "quotes": quote_accuracy(quotes),
        "trend": [
            {
                "date": row["sessionDate"],
                "avgWaitMinutes": row["avgWaitMinutes"],
                "avgOverrunMinutes": row["avgOverrunMinutes"],
                "seen": row["seen"],
                "waitsMeasured": row["waitsMeasured"],
                "overrunsMeasured": row["overrunsMeasured"],
            }
            for row in daily
        ],
        "adoptionDate": adoption,
        "loss": loss,
        "lossByDay": [
            {
                "date": row["sessionDate"],
                "uncollectedPoisha": max(0, row["forgonePoisha"] - row["prepaidPoisha"]),
                "recoveredPoisha": row["recoveredPoisha"],
            }
            for row in loss_days
        ],
        "revenue": {
            "byDoctor": by_doctor,
            "byDepartment": by_department,
            "byMethod": by_method,
            "byService": _with_declared_zeroes(by_service),
            "collectedPoisha": _total(daily, "collectedPoisha"),
            "billedPoisha": _total(daily, "billedPoisha"),
            "refundedPoisha": _total(daily, "refundedPoisha"),
        },
        "staff": punctuality_by_doctor(timings),
        "beds": beds,
        "referrals": referrals_view,
        "feedback": {"summary": feedback_view, "complaints": complaints},
        "forecast": forecast_volume(history),
        "freshness": {
            "snapshotAt": _iso_or_none(snapshot_at),
            "referralsAt": None if referrals_view is None else referrals_view["asOf"],
            "feedbackAt": feedback_view["asOf"],
            "serverTs": now_iso(),
        },
    }


# --- FR-ADM-10, the export -----------------------------------------------

EXPORTABLE = (
    "today",
    "trend",
    "loss",
    "revenue-doctor",
    "revenue-department",
    "revenue-method",
    "revenue-service",
    "staff",
    "beds",
    "referrals",
    "feedback",
    "forecast",
)


def is_exportable(view: str) -> bool:
    return view in EXPORTABLE


def _revenue_table(slices: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "header": ["label", "label_en", "bookings", "billed_poisha", "collected_poisha", "refunded_poisha"],
        "rows": [
            [s["label"], s["labelEn"], s["bookings"], s["billedPoisha"], s["collectedPoisha"], s["refundedPoisha"]]
            for s in slices
        ],
    }


_SCORE_OF = {"wait": "waitScore", "doctor": "doctorScore", "cleanliness": "cleanlinessScore", "billing": "billingScore"}


def _table_for(data: dict[str, Any], view: str) -> dict[str, Any]:
    today, quotes = data["today"], data["quotes"]
    if view == "today":
        return {
            "header": ["metric", "value"],
            "rows": [
                ["seen", today["seen"]],
                ["booked", today["booked"]],
                ["no_shows", today["noShows"]],
                ["cancelled", today["cancelled"]],
                ["walkin", today["walkin"]],
                ["booked_ahead", today["bookedAhead"]],
                ["avg_wait_minutes", today["avgWaitMinutes"]],
                ["longest_wait_minutes", today["longestWaitMinutes"]],
                ["waits_measured", today["waitsMeasured"]],
                ["avg_overrun_minutes", today["avgOverrunMinutes"]],
                ["longest_overrun_minutes", today["longestOverrunMinutes"]],
                ["overruns_measured", today["overrunsMeasured"]],
                ["sessions_total", today["sessionsTotal"]],
                ["sessions_late", today["sessionsLate"]],
                ["sessions_never_started", today["sessionsNeverStarted"]],
                ["quotes_given", quotes["quoted"]],
                ["quotes_kept", quotes["kept"]],
                ["quote_avg_over_minutes", quotes["avgOverMinutes"]],
            ],
        }
    if view == "trend":
        return {
            "header": ["date", "avg_wait_minutes", "waits_measured", "avg_overrun_minutes", "overruns_measured", "seen"],
            "rows": [
                [p["date"], p["avgWaitMinutes"], p["waitsMeasured"], p["avgOverrunMinutes"], p["overrunsMeasured"], p["seen"]]
                for p in data["trend"]
            ],
        }
    if view == "loss":
        return {
            "header": ["date", "uncollected_poisha", "recovered_poisha"],
            "rows": [[r["date"], r["uncollectedPoisha"], r["recoveredPoisha"]] for r in data["lossByDay"]],
        }
    if view == "revenue-doctor":
        return _revenue_table(data["revenue"]["byDoctor"])
    if view == "revenue-department":
        return _revenue_table(data["revenue"]["byDepartment"])
    if view == "revenue-method":
        return _revenue_table(data["revenue"]["byMethod"])
    if view == "revenue-service":
        return _revenue_table(data["revenue"]["byService"])
    if view == "staff":
        return {
            "header": [
                "doctor",
                "department",
                "sessions",
                "never_started",
                "on_time",
                "median_delta_minutes",
                "worst_delta_minutes",
                "avg_consult_seconds",
                "seen",
            ],
            "rows": [
                [
                    r["doctorNameEn"],
                    r["departmentNameBn"],
                    r["sessions"],
                    r["neverStarted"],
                    r["onTime"],
                    r["medianDeltaMinutes"],
                    r["worstDeltaMinutes"],
                    r["avgConsultSeconds"],
                    r["seen"],
                ]
                for r in data["staff"]
            ],
        }
    if view == "beds":
        return {
            "header": ["kind", "total", "occupied", "admissions", "alos_hours", "turnover_hours"],
            "rows": [
                [r["kind"], r["total"], r["occupied"], r["admissions"], r["alosHours"], r["turnoverHours"]]
                for r in data["beds"]
            ],
        }
    if view == "referrals":
        flow = data["referrals"]
        return {
            "header": ["metric", "value"],
            "rows": []
            if flow is None
            else [
                ["sent_total", flow["sentTotal"]],
                ["sent_accepted", flow["sentAccepted"]],
                ["sent_declined", flow["sentDeclined"]],
                ["sent_open", flow["sentOpen"]],
                ["leaked", flow["leaked"]],
                ["received_total", flow["receivedTotal"]],
                ["received_accepted", flow["receivedAccepted"]],
                ["received_declined", flow["receivedDeclined"]],
                ["received_open", flow["receivedOpen"]],
            ],
        }
    if view == "feedback":
        summary = data["feedback"]["summary"]
        return {
            "header": ["category", "average", "answered", "complaints"],
            "rows": [
                [c["category"], summary[_SCORE_OF[c["category"]]], c["answered"], c["complaints"]]
                for c in data["feedback"]["complaints"]
            ],
        }
    return {
        "header": ["weekday", "slot", "expected", "low", "high", "observations"],
        "rows": [
            [p["weekday"], p["slot"], p["expected"], p["low"], p["high"], p["observations"]] for p in data["forecast"]
        ],
    }


BOM = "﻿"
_FORMULA = re.compile(r"^[=+\-@\t\r]")
_NEEDS_QUOTES = re.compile(r'[",\r\n]')


def _escape_csv(value: Any) -> str:
    if value is None:
        return ""
    text = js_str(value)
    # A leading =, +, - or @ makes a spreadsheet read the cell as a formula:
    # guarded with an apostrophe and quoted, so the whole value is text.
    if _FORMULA.search(text):
        return '"\'' + text.replace('"', '""') + '"'
    return '"' + text.replace('"', '""') + '"' if _NEEDS_QUOTES.search(text) else text


def to_csv(header: list[str], rows: list[list[Any]]) -> str:
    """RFC 4180 with a UTF-8 byte-order mark, so Excel on Windows reads Bangla."""
    lines = [",".join(_escape_csv(cell) for cell in header), *(",".join(_escape_csv(cell) for cell in row) for row in rows)]
    return BOM + "\r\n".join(lines) + "\r\n"


def export_view(
    *,
    hospital_id: str,
    date_from: str,
    date_to: str,
    view: str,
    staff_user_id: str | None,
    ip: str | None,
    user_agent: str | None,
) -> dict[str, Any]:
    data = dashboard(hospital_id=hospital_id, date_from=date_from, date_to=date_to)
    table = _table_for(data, view)
    csv = to_csv(table["header"], table["rows"])
    with db.transaction():
        admin_repo.record_export(
            staff_user_id=staff_user_id,
            hospital_id=hospital_id,
            view=view,
            date_from=data["range"]["from"],
            date_to=data["range"]["to"],
            rows=len(table["rows"]),
            ip=ip,
            user_agent=user_agent,
        )
    return {
        "filename": f"{view}-{data['range']['from']}-to-{data['range']['to']}.csv",
        "csv": csv,
        "rows": len(table["rows"]),
    }


# --- the hospital now (FR-ADM-12, CARD-B10-NOW) -----------------------------


def overview(hospital_id: str) -> dict[str, Any]:
    now = now_iso()
    date = to_dhaka_date(now)
    counts = admin_repo.overview_today(
        hospital_id=hospital_id, date=date, on_the_way=list(ON_THE_WAY_STATES), in_er=list(IN_ER_STATES)
    )
    capacity = bed_repo.public_capacity([hospital_id])
    chamber_board = chambers_today(hospital_id, date)
    published = capacity.get(hospital_id)
    return {
        "date": date,
        **chamber_board,
        "doctors": {"scheduled": counts["doctorsScheduled"], "sitting": counts["doctorsSitting"]},
        "waiting": counts["waiting"],
        "appointments": {"booked": counts["appointments"], "seen": counts["seen"]},
        "beds": {"free": published["bedFree"], "total": published["bedTotal"], "asOf": published["bedsAsOf"]}
        if counts["bedsOn"] and published is not None and published["bedTotal"] > 0
        else None,
        "emergency": counts["emergency"],
        "serverTs": now,
    }
