"""Whether chambers start when they said they would (port of `admin/punctuality.ts`; FR-ADM-05).

Median lateness, not mean; a session that never started is counted apart;
early is not punctual, so on time is a band either side of zero.
"""

from __future__ import annotations

import functools
from typing import Any

from ..jsfmt import locale_compare
from ..time import js_round

SESSION_ON_TIME_MINUTES = 10


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[middle]
    return js_round((ordered[middle - 1] + ordered[middle]) / 2)


def _reduce_doctor(group: list[dict[str, Any]]) -> dict[str, Any]:
    first = group[0]
    deltas = [timing["startDeltaMinutes"] for timing in group if timing["startDeltaMinutes"] is not None]
    seen = sum(timing["seen"] for timing in group)
    consult_seconds = sum(
        timing["avgConsultSeconds"] * timing["seen"] for timing in group if timing["avgConsultSeconds"] is not None
    )
    on_time = sum(1 for delta in deltas if abs(delta) <= SESSION_ON_TIME_MINUTES)
    return {
        "doctorId": first["doctorId"],
        "doctorNameBn": first["doctorNameBn"],
        "doctorNameEn": first["doctorNameEn"],
        "departmentNameBn": first["departmentNameBn"],
        "departmentNameEn": first["departmentNameEn"],
        "sessions": len(group),
        "neverStarted": len(group) - len(deltas),
        "onTime": on_time,
        "medianDeltaMinutes": _median(deltas),
        "worstDeltaMinutes": max(deltas) if deltas else None,
        "avgConsultSeconds": None if seen == 0 else js_round(consult_seconds / seen),
        "onTimeRate": None if not deltas else on_time / len(deltas),
        "seen": seen,
    }


def punctuality_by_doctor(timings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for timing in timings:
        groups.setdefault(timing["doctorId"], []).append(timing)
    rows = [_reduce_doctor(group) for group in groups.values()]

    def compare(a: dict[str, Any], b: dict[str, Any]) -> int:
        a_median, b_median = a["medianDeltaMinutes"], b["medianDeltaMinutes"]
        if a_median is None and b_median is None:
            return locale_compare(a["doctorNameEn"], b["doctorNameEn"])
        if a_median is None:
            return 1
        if b_median is None:
            return -1
        if a_median != b_median:
            return 1 if b_median > a_median else -1
        return locale_compare(a["doctorNameEn"], b["doctorNameEn"])

    return sorted(rows, key=functools.cmp_to_key(compare))
