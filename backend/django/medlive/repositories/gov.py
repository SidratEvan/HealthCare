"""The national layer's reads, through aggregate views only (port of `repositories/gov.repo.ts`; FR-GOV-*).

Every read runs read-only as `gov_reader`, a role that can see the `v_gov_*`
views and nothing else, so no identifiable row is reachable from here even
by mistake.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import datetime
from typing import Any, TypeVar

from ..core import db
from ..domain.enums import SYMPTOM_SIGNALS
from ..domain.time import from_datetime, from_epoch_ms, parse_ms

T = TypeVar("T")


@contextmanager
def _as_gov_reader() -> Iterator[None]:
    with db.transaction():
        db.execute("SET TRANSACTION READ ONLY")
        db.execute("SET LOCAL ROLE gov_reader")
        yield


def _read(body: Callable[[], T]) -> T:
    with _as_gov_reader():
        return body()


def _iso(value: datetime | None) -> str | None:
    return None if value is None else from_datetime(value)


def capacity_by_district() -> list[dict[str, Any]]:
    def body() -> list[dict[str, Any]]:
        rows = db.fetch_all(
            """
            SELECT division, district, facilities, bed_total, bed_free, icu_total,
                   icu_free, burn_units_open, er_active, beds_as_of, capability_as_of,
                   by_kind
              FROM v_gov_capacity
             ORDER BY division, district
            """
        )
        return [
            {
                "division": r["division"],
                "district": r["district"],
                "facilities": r["facilities"],
                "bedTotal": r["bed_total"],
                "bedFree": r["bed_free"],
                "icuTotal": r["icu_total"],
                "icuFree": r["icu_free"],
                "burnUnitsOpen": r["burn_units_open"],
                "erActive": r["er_active"],
                "bedsAsOf": _iso(r["beds_as_of"]),
                "capabilityAsOf": _iso(r["capability_as_of"]),
                "byKind": [
                    {
                        "kind": entry["kind"],
                        "total": entry["total"],
                        "free": entry["free"],
                        "asOf": None if entry["asOf"] is None else from_epoch_ms(parse_ms(entry["asOf"])),
                    }
                    for entry in r["by_kind"]
                ],
            }
            for r in rows
        ]

    return _read(body)


def er_load(since: datetime) -> dict[str, list[dict[str, Any]]]:
    def body() -> dict[str, list[dict[str, Any]]]:
        now = db.fetch_all(
            """
            SELECT division, district, open, on_the_way, red, as_of
              FROM v_gov_er_now
             ORDER BY division, district
            """
        )
        hours = db.fetch_all(
            """
            SELECT district, hour, cases, red
              FROM v_gov_er_hourly
             WHERE hour >= %s
             ORDER BY district, hour
            """,
            [since],
        )
        return {
            "now": [
                {
                    "division": r["division"],
                    "district": r["district"],
                    "open": r["open"],
                    "onTheWay": r["on_the_way"],
                    "red": r["red"],
                    "asOf": _iso(r["as_of"]),
                }
                for r in now
            ],
            "hours": [
                {"district": r["district"], "hour": from_datetime(r["hour"]), "cases": r["cases"], "red": r["red"]}
                for r in hours
            ],
        }

    return _read(body)


def symptom_signals(from_day: str) -> dict[str, list[dict[str, Any]]]:
    def body() -> dict[str, list[dict[str, Any]]]:
        days = db.fetch_all(
            """
            SELECT division, district, signal, day::text AS day, cases
              FROM v_gov_symptom_daily
             WHERE day >= %s::date
             ORDER BY district, signal, day
            """,
            [from_day],
        )
        reporting = db.fetch_all(
            """
            SELECT division, district, first_day::text AS first_day, last_signed_at
              FROM v_gov_reporting
             ORDER BY division, district
            """
        )
        return {
            "days": [
                {
                    "division": r["division"],
                    "district": r["district"],
                    "signal": r["signal"],
                    "day": r["day"],
                    "cases": r["cases"],
                }
                for r in days
                if r["signal"] in SYMPTOM_SIGNALS
            ],
            "reporting": [
                {
                    "division": r["division"],
                    "district": r["district"],
                    "firstDay": r["first_day"],
                    "lastSignedAt": _iso(r["last_signed_at"]),
                }
                for r in reporting
            ],
        }

    return _read(body)


def benchmark_rows() -> list[dict[str, Any]]:
    def body() -> list[dict[str, Any]]:
        rows = db.fetch_all(
            """
            SELECT kind, avg_wait_minutes, waits_measured, median_turnaround_hours,
                   turnarounds_measured, wait_score, doctor_score, cleanliness_score,
                   billing_score, responses
              FROM v_gov_benchmark
            """
        )
        return [
            {
                "kind": r["kind"],
                "avgWaitMinutes": r["avg_wait_minutes"],
                "waitsMeasured": r["waits_measured"],
                "medianTurnaroundHours": r["median_turnaround_hours"],
                "turnaroundsMeasured": r["turnarounds_measured"],
                "waitScore": r["wait_score"],
                "doctorScore": r["doctor_score"],
                "cleanlinessScore": r["cleanliness_score"],
                "billingScore": r["billing_score"],
                "responses": r["responses"],
            }
            for r in rows
        ]

    return _read(body)
