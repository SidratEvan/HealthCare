"""Which ER to go to (port of `emergency/ranking.ts`; FR-ER-02, FR-ER-03, FR-PAT-16).

A hospital that can treat the problem comes first, then one whose figures
are fresh, then the nearest by road, the least loaded, the most beds free.
"""

from __future__ import annotations

import functools
from typing import Any

PROBLEM_CAPABILITY: dict[str, str | None] = {
    "burn": "burn_unit",
    "accident": "trauma_ot",
    "cardiac": "cardiac",
    "stroke": "stroke",
    "breathing": None,
    "child": None,
    "obstetric": None,
    "other": None,
}

PROBLEM_BED_KIND: dict[str, str | None] = {
    "burn": "burn",
    "accident": None,
    "cardiac": None,
    "stroke": None,
    "breathing": None,
    "child": None,
    "obstetric": None,
    "other": None,
}

EMERGENCY_SEARCH_RADIUS_METRES = 50_000


def required_capability(problem: str | None) -> str | None:
    return None if problem is None else PROBLEM_CAPABILITY[problem]


def relevant_bed_kind(problem: str | None) -> str | None:
    return None if problem is None else PROBLEM_BED_KIND[problem]


def need_for(problem: str | None) -> dict[str, str | None]:
    return {"capability": required_capability(problem), "bedKind": relevant_bed_kind(problem)}


def free_beds_for(need: dict[str, Any], figures: dict[str, Any]) -> int | None:
    if need["bedKind"] is not None:
        entry = next((entry for entry in figures["byKind"] if entry["kind"] == need["bedKind"]), None)
        return None if entry is None else entry["free"]
    return None if figures["bedTotal"] == 0 else figures["bedFree"]


def relevant_free_beds(problem: str | None, figures: dict[str, Any]) -> int | None:
    return free_beds_for(need_for(problem), figures)


def stamps_for_need(need: dict[str, Any], figures: dict[str, Any]) -> list[str | None]:
    stamps: list[str | None] = []
    if need["capability"] is not None:
        stamps.append(figures["capabilityAsOf"])
    if need["bedKind"] is not None:
        entry = next((candidate for candidate in figures["byKind"] if candidate["kind"] == need["bedKind"]), None)
        if entry is not None:
            stamps.append(entry["asOf"])
    elif figures["bedTotal"] > 0:
        stamps.append(figures["bedsAsOf"])
    return stamps


def stamps_for(problem: str | None, figures: dict[str, Any]) -> list[str | None]:
    return stamps_for_need(need_for(problem), figures)


def _rank_of(has_capability: bool | None) -> int:
    return 1 if has_capability is False else 0


def _ascending_nulls_last(a: float | None, b: float | None) -> float:
    if a == b:
        return 0
    if a is None:
        return 1
    if b is None:
        return -1
    return a - b


def _negate(value: float | None) -> float | None:
    return None if value is None else -value


def compare_candidates(a: dict[str, Any], b: dict[str, Any]) -> float:
    return (
        _rank_of(a["hasCapability"]) - _rank_of(b["hasCapability"])
        or int(a["stale"]) - int(b["stale"])
        or _ascending_nulls_last(a["travelMinutes"], b["travelMinutes"])
        or _ascending_nulls_last(a["erLoad"], b["erLoad"])
        or _ascending_nulls_last(_negate(a["freeBeds"]), _negate(b["freeBeds"]))
        or (-1 if a["hospitalId"] < b["hospitalId"] else 1 if a["hospitalId"] > b["hospitalId"] else 0)
    )


def rank_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def compare(a: dict[str, Any], b: dict[str, Any]) -> int:
        value = compare_candidates(a, b)
        return (value > 0) - (value < 0)

    return sorted(candidates, key=functools.cmp_to_key(compare))
