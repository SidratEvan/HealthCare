"""How many patients to expect, for the rota (port of `admin/forecast.ts`; FR-ADM-09).

The mean of the same weekday and part of the day over the trailing weeks,
with the observed range and how many sessions it rests on. Below two
observations the answer is "we do not know", not a number (PRD.md §3.2).
"""

from __future__ import annotations

from typing import Any

from ..time import js_round

MIN_OBSERVATIONS = 2

_SLOT_ORDER = {"morning": 0, "afternoon": 1, "evening": 2}


def forecast_volume(history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[int, str], list[int]] = {}
    for row in history:
        groups.setdefault((row["weekday"], row["slot"]), []).append(row["seen"])
    points: list[dict[str, Any]] = []
    for (weekday, slot), counts in groups.items():
        enough = len(counts) >= MIN_OBSERVATIONS
        points.append(
            {
                "weekday": weekday,
                "slot": slot,
                "expected": js_round(sum(counts) / len(counts)) if enough else None,
                "low": min(counts) if enough else None,
                "high": max(counts) if enough else None,
                "observations": len(counts),
            }
        )
    return sorted(points, key=lambda point: (point["weekday"], _SLOT_ORDER[point["slot"]]))
