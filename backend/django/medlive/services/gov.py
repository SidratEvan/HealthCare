"""The national layer (port of `services/gov.service.ts`; S-B-13, FR-GOV-01..06).

Four reads, one per section of the screen. The rows come from `gov` as
`gov_reader`, which can open nothing but the aggregate views; the arithmetic
is `domain/gov.py`. Every payload is walked by `find_identifiers` before it
is returned, and one that carries an identifier is not sent at all (a 500 and
a log line naming the path, never the value). What nothing records
(ventilators, blood) is said to be unrecorded, never left out.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from ..core.errors import AppError
from ..core.logging import logger
from ..domain.gov import (
    BASELINE_MAX_DAYS,
    MIN_BENCHMARK_SAMPLE,
    SIGNAL_WINDOW_DAYS,
    SPIKE_MIN_CASES,
    SPIKE_RATIO,
    add_days,
    benchmark,
    find_identifiers,
    read_signals,
)
from ..domain.time import from_datetime, now_iso, to_dhaka_date, utc_now
from ..repositories import gov as gov_repo

ER_WINDOW_HOURS = 24
BENCHMARK_WINDOW_DAYS = 30
UNRECORDED_CAPACITY = ("ventilators", "blood")


def aggregate_only(section: str, payload: Any) -> Any:
    """Returns `payload` unchanged, or refuses to send it at all."""
    found = find_identifiers(payload)
    if found:
        # The paths, never the values: a value here is exactly what must not
        # be written anywhere, a log included.
        logger.error({"section": section, "paths": found}, "gov payload carried an identifier; refused")
        raise AppError(
            "INTERNAL",
            message="This figure could not be shown without identifying somebody.",
            details={"reason": "identifier_in_aggregate", "section": section},
        )
    return payload


def _oldest(a: str | None, b: str | None) -> str | None:
    if a is None:
        return b
    if b is None:
        return a
    return a if a < b else b


def _newest(a: str | None, b: str | None) -> str | None:
    if a is None:
        return b
    if b is None:
        return a
    return a if a > b else b


def totals_of(districts: list[dict[str, Any]]) -> dict[str, Any]:
    with_beds = [district for district in districts if district["bedTotal"] > 0]
    icu = [district for district in districts if district["icuTotal"] is not None]
    kinds: dict[str, dict[str, Any]] = {}
    for district in districts:
        for entry in district["byKind"]:
            current = kinds.get(entry["kind"], {"total": 0, "free": 0, "asOf": None, "unknown": False})
            kinds[entry["kind"]] = {
                "total": current["total"] + entry["total"],
                "free": current["free"] + entry["free"],
                "asOf": _oldest(current["asOf"], entry["asOf"]),
                "unknown": current["unknown"] or entry["asOf"] is None,
            }
    beds_as_of: str | None = None
    if not any(district["bedsAsOf"] is None for district in with_beds):
        for district in with_beds:
            beds_as_of = _oldest(beds_as_of, district["bedsAsOf"])
    return {
        "facilities": sum(district["facilities"] for district in districts),
        "bedTotal": sum(district["bedTotal"] for district in districts),
        "bedFree": sum(district["bedFree"] for district in districts),
        "icuTotal": None if not icu else sum(district["icuTotal"] or 0 for district in icu),
        "icuFree": None if not icu else sum(district["icuFree"] or 0 for district in icu),
        "burnUnitsOpen": sum(district["burnUnitsOpen"] for district in districts),
        "erActive": sum(district["erActive"] for district in districts),
        "bedsAsOf": beds_as_of,
        "byKind": [
            {"kind": kind, "total": entry["total"], "free": entry["free"], "asOf": None if entry["unknown"] else entry["asOf"]}
            for kind, entry in kinds.items()
        ],
    }


def capacity() -> dict[str, Any]:
    districts = gov_repo.capacity_by_district()
    return aggregate_only(
        "capacity", {"districts": districts, "totals": totals_of(districts), "unrecorded": list(UNRECORDED_CAPACITY)}
    )


def er_load(now: datetime | None = None) -> dict[str, Any]:
    # Dhaka is UTC+6 exactly, so a UTC hour boundary is a Dhaka one too.
    current = (now or utc_now()).replace(minute=0, second=0, microsecond=0)
    hour_starts = [current - timedelta(hours=ER_WINDOW_HOURS - 1 - index) for index in range(ER_WINDOW_HOURS)]
    hours = [from_datetime(at) for at in hour_starts]
    rows = gov_repo.er_load(hour_starts[0])
    cells = {(row["district"], row["hour"]): row for row in rows["hours"]}
    districts = [
        {
            **district,
            "hourly": [
                {
                    "cases": cells[(district["district"], hour)]["cases"] if (district["district"], hour) in cells else 0,
                    "red": cells[(district["district"], hour)]["red"] if (district["district"], hour) in cells else 0,
                }
                for hour in hours
            ],
        }
        for district in rows["now"]
    ]
    return aggregate_only(
        "er-load",
        {
            "windowHours": ER_WINDOW_HOURS,
            "hours": hours,
            "districts": districts,
            "totals": {
                "open": sum(district["open"] for district in districts),
                "onTheWay": sum(district["onTheWay"] for district in districts),
                "red": sum(district["red"] for district in districts),
            },
            "peak": max([0, *(cell["cases"] for district in districts for cell in district["hourly"])]),
        },
    )


def signals() -> dict[str, Any]:
    today = to_dhaka_date(now_iso())
    from_day = add_days(today, -(SIGNAL_WINDOW_DAYS - 1 + BASELINE_MAX_DAYS))
    rows = gov_repo.symptom_signals(from_day)
    as_of: str | None = None
    for row in rows["reporting"]:
        as_of = _newest(as_of, row["lastSignedAt"])
    return aggregate_only(
        "signals",
        {
            "today": today,
            "rule": {
                "windowDays": SIGNAL_WINDOW_DAYS,
                "baselineDays": BASELINE_MAX_DAYS,
                "minCases": SPIKE_MIN_CASES,
                "ratio": SPIKE_RATIO,
            },
            "readings": read_signals(rows["days"], rows["reporting"], today),
            "asOf": as_of,
        },
    )


def benchmarks() -> dict[str, Any]:
    rows = gov_repo.benchmark_rows()
    return aggregate_only(
        "benchmarks",
        {
            "windowDays": BENCHMARK_WINDOW_DAYS,
            "minSample": MIN_BENCHMARK_SAMPLE,
            "facilities": len(rows),
            "measures": benchmark(rows),
            "asOf": now_iso(),
        },
    )
