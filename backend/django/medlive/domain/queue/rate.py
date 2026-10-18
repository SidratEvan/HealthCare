"""The rolling consultation rate (port of `queue/rate.ts`; FR-QUE-10, FR-QUE-12).

Every ETA is this number times the patients ahead. Responsive (an
exponentially weighted average) and stable (a bounded weight, clamped
inputs). Pure: the same samples in the same order give the same number.
"""

from __future__ import annotations

import math
from typing import Any

from ..time import difference_in_seconds, js_round

RATE_ALPHA = 0.3
RATE_WINDOW = 12
MIN_CONSULT_SECONDS = 30
MAX_CONSULT_SECONDS = 3600

DEFAULT_SPREAD_RATIO = 0.4
MIN_SPREAD_RATIO = 0.15


def seed_rate(default_consult_seconds: float) -> dict[str, Any]:
    seconds = clamp_consult_seconds(default_consult_seconds)
    return {"seedSeconds": seconds, "currentSeconds": seconds, "samples": []}


def clamp_consult_seconds(seconds: float) -> int:
    if not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or not math.isfinite(seconds):
        return MIN_CONSULT_SECONDS
    return min(MAX_CONSULT_SECONDS, max(MIN_CONSULT_SECONDS, js_round(seconds)))


def measured_consult_seconds(called_at: str | None, now: str) -> int:
    """Measured from the call, never typed (FR-REC-11); 0 when never called."""
    if called_at is None:
        return 0
    return clamp_consult_seconds(max(0, difference_in_seconds(now, called_at)))


def observe_consult(rate: dict[str, Any], seconds: float) -> dict[str, Any]:
    observed = clamp_consult_seconds(seconds)
    samples = [*rate["samples"], observed][-RATE_WINDOW:]
    observation_count = len(rate["samples"]) + 1
    weight = max(RATE_ALPHA, 1 / observation_count)
    current = js_round(weight * observed + (1 - weight) * rate["currentSeconds"])
    return {
        "seedSeconds": rate["seedSeconds"],
        "currentSeconds": clamp_consult_seconds(current),
        "samples": samples,
    }


def current_rate_seconds(rate: dict[str, Any]) -> float:
    return rate["currentSeconds"]


def rate_spread_seconds(rate: dict[str, Any]) -> int:
    samples = rate["samples"]
    if len(samples) < 2:
        return js_round(rate["currentSeconds"] * DEFAULT_SPREAD_RATIO)
    total = 0
    for value in samples:
        total = total + value
    mean = total / len(samples)
    squares = 0.0
    for value in samples:
        squares = squares + (value - mean) ** 2
    variance = squares / len(samples)
    return max(js_round(math.sqrt(variance)), js_round(rate["currentSeconds"] * MIN_SPREAD_RATIO))


def is_measured(rate: dict[str, Any]) -> bool:
    return len(rate["samples"]) > 0
