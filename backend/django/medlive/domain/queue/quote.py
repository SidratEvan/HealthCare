"""The wait a check-in quotes by default (port of `queue/quote.ts`; FR-REC-18)."""

from __future__ import annotations

from typing import Any

from ..time import difference_in_seconds, js_round
from .eta import compute_etas
from .rules import MAX_QUOTED_WAIT_MINUTES

QUOTE_STEP_MINUTES = 5


def suggested_quote(state: dict[str, Any], booking_id: str, now: str) -> int | None:
    eta = next((e for e in compute_etas(state, now) if e["bookingId"] == booking_id), None)
    if eta is None:
        return None
    minutes = max(0, difference_in_seconds(eta["etaAt"], now) / 60)
    rounded = js_round(minutes / QUOTE_STEP_MINUTES) * QUOTE_STEP_MINUTES
    return min(MAX_QUOTED_WAIT_MINUTES, rounded)
