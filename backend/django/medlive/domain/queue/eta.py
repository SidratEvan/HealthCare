"""When will I be called? (port of `queue/eta.ts`; FR-QUE-11..15).

Deliberately a little conservative, carried with an honest confidence band,
and never allowed to jump earlier without the caller knowing (FR-QUE-15).
Pure: `now` is an argument.
"""

from __future__ import annotations

import math
from typing import Any, Mapping

from ..time import add_seconds, difference_in_seconds, floor_to_minute, is_after, max_timestamp
from .rate import current_rate_seconds, is_measured, rate_spread_seconds
from .state import QueueState, active_queue, now_serving, waiting_queue

MIN_BAND_MINUTES = 5
MAX_BAND_MINUTES = 45


def compute_etas(
    state: QueueState, now: str, previous: Mapping[str, str] | None = None
) -> list[dict[str, Any]]:
    rate_seconds = current_rate_seconds(state["rate"])
    spread_seconds = rate_spread_seconds(state["rate"])
    confidence = _confidence_of(state)
    cursor = _baseline_for(state, now)
    etas: list[dict[str, Any]] = []
    ahead = 0
    for entry in active_queue(state):
        if entry["status"] == "in_chamber":
            elapsed = 0 if entry["calledAt"] is None else max(0, difference_in_seconds(now, entry["calledAt"]))
            cursor = add_seconds(cursor, max(0, rate_seconds - elapsed))
            ahead += 1
            continue
        eta_at = floor_to_minute(cursor)
        told = None if previous is None else previous.get(entry["bookingId"])
        etas.append(
            {
                "bookingId": entry["bookingId"],
                "serial": entry["serial"],
                "patientsAhead": ahead,
                "etaAt": eta_at,
                "bandMinutes": band_minutes(ahead, spread_seconds, confidence),
                "confidence": confidence,
                "movedEarlier": told is not None and eta_at < told,
            }
        )
        cursor = add_seconds(cursor, rate_seconds)
        ahead += 1
    return etas


def earlier_than_told(
    state: QueueState,
    etas: list[dict[str, Any]],
    told: Mapping[str, str],
    planned_start: str,
) -> list[dict[str, Any]]:
    present = {e["bookingId"] for e in state["entries"] if e["arrivedAt"] is not None}
    out = []
    for eta in etas:
        if eta["confidence"] == "unknown" or eta["bookingId"] in present:
            continue
        told_at = told.get(eta["bookingId"], planned_start)
        if difference_in_seconds(told_at, eta["etaAt"]) > eta["bandMinutes"] * 60:
            out.append(eta)
    return out


def eta_for(state: QueueState, booking_id: str, now: str, previous: Mapping[str, str] | None = None) -> dict[str, Any] | None:
    return next((e for e in compute_etas(state, now, previous) if e["bookingId"] == booking_id), None)


def _baseline_for(state: QueueState, now: str) -> str:
    if state["doctorArrivedAt"] is None:
        planned_with_delay = add_seconds(state["plan"]["plannedStart"], state["delayMinutes"] * 60)
        return max_timestamp(planned_with_delay, now)
    return now if state["hold"] is None else max_timestamp(state["hold"]["until"], now)


def outstanding_delay_minutes(state: QueueState, now: str) -> int:
    if state["doctorArrivedAt"] is None:
        return state["delayMinutes"]
    if state["hold"] is None or not is_after(state["hold"]["until"], now):
        return 0
    return state["hold"]["minutes"]


def _confidence_of(state: QueueState) -> str:
    if state["status"] in ("paused", "ended", "cancelled"):
        return "unknown"
    if state["doctorArrivedAt"] is None:
        return "unknown"
    return "measured" if is_measured(state["rate"]) else "estimated"


def band_minutes(patients_ahead: int, spread_seconds: float, confidence: str) -> int:
    if confidence == "unknown":
        return MAX_BAND_MINUTES
    spread_minutes = spread_seconds / 60
    raw = math.sqrt(max(1, patients_ahead)) * spread_minutes
    return min(MAX_BAND_MINUTES, max(MIN_BAND_MINUTES, math.ceil(raw)))


def should_leave_now(eta: dict[str, Any], now: str, travel_minutes: float, buffer_minutes: float = 10) -> bool:
    if eta["confidence"] == "unknown":
        return False
    minutes_until = difference_in_seconds(eta["etaAt"], now) / 60
    return minutes_until <= travel_minutes + buffer_minutes


def two_away_bookings(state: QueueState) -> list[str]:
    waiting = waiting_queue(state)
    offset = 0 if now_serving(state) is None else 1
    index = 2 - offset
    return [waiting[index]["bookingId"]] if 0 <= index < len(waiting) else []


def projected_end(state: QueueState, now: str) -> str | None:
    queue = active_queue(state)
    if not queue or _confidence_of(state) == "unknown":
        return None
    rate_seconds = current_rate_seconds(state["rate"])
    return floor_to_minute(add_seconds(_baseline_for(state, now), len(queue) * rate_seconds))
