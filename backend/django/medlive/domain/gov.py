"""The national layer's arithmetic (port of `gov/identifiers.ts`, `gov/signals.ts`
and `gov/benchmark.ts`; FR-GOV-03, FR-GOV-04, FR-GOV-06). No I/O.

- `find_identifiers`: the last check before anything leaves the layer. Any key
  that names a person or a record, and any value shaped like a UUID or a
  Bangladeshi mobile number, wherever it sits. The database role is the first
  line; this is the second.
- `read_signals`: a spike is this week at least double the district's usual
  week and at least five cases; a district without a full week of reporting
  before this one has too little history, never "normal".
- `benchmark`: each measure ranked on its own, so no facility can be followed
  across columns; a facility resting on fewer than five observations is
  counted as too few, not ranked.
"""

from __future__ import annotations

import functools
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from .enums import SYMPTOM_SIGNALS
from .jsfmt import locale_compare
from .time import js_round, parse_ms

# --- identifiers ------------------------------------------------------------

#: Case-sensitive on purpose: `Id$` is a camelCase suffix (`patientId`), and
#: case-blind it would also catch every key merely ending in the letters (`paid`).
_IDENTIFYING_KEY = re.compile(r"(?:^id$|Id$|_id$|^nid$|[Pp]hone|[Ee]mail|[Nn]ame|[Tt]oken)")
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)
_BD_MOBILE = re.compile(r"(?:\+?88)?01[3-9][0-9]{8}")


def find_identifiers(value: Any, path: str = "") -> list[str]:
    """Every path in `value` that carries an identifier, as `a.b[2].c`. Empty means clean."""
    if isinstance(value, str):
        return [path or "(root)"] if _UUID.search(value) or _BD_MOBILE.search(value) else []
    if isinstance(value, (list, tuple)):
        found: list[str] = []
        for index, item in enumerate(value):
            found += find_identifiers(item, f"{path}[{index}]")
        return found
    if isinstance(value, dict):
        found = []
        for key, child in value.items():
            at = key if path == "" else f"{path}.{key}"
            found += [at] if _IDENTIFYING_KEY.search(key) else find_identifiers(child, at)
        return found
    return []


# --- symptom signals (FR-GOV-03) --------------------------------------------

SIGNAL_WINDOW_DAYS = 7
BASELINE_MAX_DAYS = 14
BASELINE_MIN_DAYS = 7
SPIKE_MIN_CASES = 5
SPIKE_RATIO = 2


def _round1(value: float) -> float:
    return js_round(value * 10) / 10


def add_days(date: str, days: int) -> str:
    """`YYYY-MM-DD` plus whole days. Calendar arithmetic, so UTC is exact."""
    at = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=days)
    return at.strftime("%Y-%m-%d")


def _days_between(start: str, end: str) -> int:
    return js_round((parse_ms(f"{end}T00:00:00Z") - parse_ms(f"{start}T00:00:00Z")) / 86_400_000)


def _every_day(start: str, end: str) -> list[str]:
    dates: list[str] = []
    day = start
    while day <= end:
        dates.append(day)
        day = add_days(day, 1)
    return dates


def status_of(this_week: int, usual_week: float) -> str:
    return "spike" if this_week >= SPIKE_MIN_CASES and this_week >= SPIKE_RATIO * usual_week else "normal"


_RANK = {"spike": 0, "normal": 1, "too_little_history": 2}


def read_signals(days: list[dict[str, Any]], reporting: list[dict[str, Any]], today: str) -> list[dict[str, Any]]:
    window_start = add_days(today, -(SIGNAL_WINDOW_DAYS - 1))
    earliest = add_days(window_start, -BASELINE_MAX_DAYS)
    counts: dict[tuple[str, str, str], int] = {}
    for row in days:
        key = (row["district"], row["signal"], row["day"])
        counts[key] = counts.get(key, 0) + row["cases"]
    every_day = _every_day(earliest, today)
    readings: list[dict[str, Any]] = []
    for district in reporting:
        # The baseline starts at the later of the fortnight's first day and the
        # first day this district was counted at all.
        baseline_start = district["firstDay"] if district["firstDay"] > earliest else earliest
        baseline_days = max(0, _days_between(baseline_start, window_start))
        for signal in SYMPTOM_SIGNALS:
            daily = [{"day": day, "cases": counts.get((district["district"], signal, day), 0)} for day in every_day]
            this_week = sum(point["cases"] for point in daily if point["day"] >= window_start)
            baseline_cases = sum(
                point["cases"] for point in daily if baseline_start <= point["day"] < window_start
            )
            enough = baseline_days >= BASELINE_MIN_DAYS
            usual_week = (baseline_cases * SIGNAL_WINDOW_DAYS) / baseline_days if enough else None
            readings.append(
                {
                    "division": district["division"],
                    "district": district["district"],
                    "signal": signal,
                    "thisWeek": this_week,
                    "usualWeek": None if usual_week is None else _round1(usual_week),
                    "baselineDays": baseline_days if enough else 0,
                    "status": "too_little_history" if usual_week is None else status_of(this_week, usual_week),
                    "daily": daily,
                }
            )

    def compare(a: dict[str, Any], b: dict[str, Any]) -> int:
        return (
            _RANK[a["status"]] - _RANK[b["status"]]
            or locale_compare(a["district"], b["district"])
            or SYMPTOM_SIGNALS.index(a["signal"]) - SYMPTOM_SIGNALS.index(b["signal"])
        )

    return sorted(readings, key=functools.cmp_to_key(compare))


# --- benchmarking (FR-GOV-04) -----------------------------------------------

MIN_BENCHMARK_SAMPLE = 5

_MEASURES = (
    ("wait", "lower", "avgWaitMinutes", "waitsMeasured"),
    ("turnaround", "lower", "medianTurnaroundHours", "turnaroundsMeasured"),
    ("score_wait", "higher", "waitScore", "responses"),
    ("score_doctor", "higher", "doctorScore", "responses"),
    ("score_cleanliness", "higher", "cleanlinessScore", "responses"),
    ("score_billing", "higher", "billingScore", "responses"),
)


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    value = ordered[middle] if len(ordered) % 2 == 1 else (ordered[middle - 1] + ordered[middle]) / 2
    return _round1(value)


def benchmark(facilities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    measures: list[dict[str, Any]] = []
    for measure, better, value_key, sample_key in _MEASURES:
        compared: list[dict[str, Any]] = []
        too_few = 0
        for row in facilities:
            value, sample = row[value_key], row[sample_key]
            # No observations at all is absent, not "too few".
            if value is None or sample == 0:
                continue
            if sample < MIN_BENCHMARK_SAMPLE:
                too_few += 1
                continue
            compared.append({"kind": row["kind"], "value": _round1(value), "sample": sample})
        compared.sort(key=lambda entry: entry["value"] if better == "lower" else -entry["value"])
        measures.append(
            {
                "measure": measure,
                "better": better,
                "entries": compared,
                "median": _median([entry["value"] for entry in compared]),
                "tooFew": too_few,
            }
        )
    return measures
