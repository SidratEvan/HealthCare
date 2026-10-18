"""How old a figure is, and whether it is stale (port of `emergency/freshness.ts`; PRD §3.2, GR-03)."""

from __future__ import annotations

import math
from typing import Any

from ..time import to_epoch_ms

DEFAULT_STALE_THRESHOLD_MINUTES = 10


def oldest_stamp(stamps: list[str | None]) -> str | None:
    """The oldest of the stamps; None when any is missing, since a figure is as old as its oldest part."""
    if not stamps:
        return None
    oldest: str | None = None
    for stamp in stamps:
        if stamp is None:
            return None
        if oldest is None or to_epoch_ms(stamp) < to_epoch_ms(oldest):
            oldest = stamp
    return oldest


def age_in_minutes(as_of: str | None, now: str) -> int | None:
    if as_of is None:
        return None
    return max(0, math.floor((to_epoch_ms(now) - to_epoch_ms(as_of)) / 60_000))


def freshness_of(stamps: list[str | None], now: str, threshold_minutes: float) -> dict[str, Any]:
    as_of = oldest_stamp(stamps)
    age_minutes = age_in_minutes(as_of, now)
    return {"asOf": as_of, "ageMinutes": age_minutes, "stale": age_minutes is None or age_minutes >= threshold_minutes}
