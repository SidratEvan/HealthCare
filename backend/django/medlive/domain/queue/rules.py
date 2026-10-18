"""The guards between a tap and the event log (port of `queue/rules.ts`; FR-QUE-20..22).

Each returns `{"ok": True}` or `{"ok": False, "code", "detail"}`; the code is
what `QUEUE_GUARD_FAILED` carries to the client, which picks the Bangla copy.
"""

from __future__ import annotations

import math
from typing import Any

from ..jsfmt import js_str
from ..time import difference_in_minutes, difference_in_seconds
from .rate import current_rate_seconds
from .state import QueueEntry, QueueState, active_queue, find_entry, now_serving, pending_offers, waiting_queue

GuardResult = dict[str, Any]

ALLOWED: GuardResult = {"ok": True}


def _deny(code: str, detail: str) -> GuardResult:
    return {"ok": False, "code": code, "detail": detail}


DEFAULT_QUEUE_SETTINGS = {
    "noShowGracePatients": 2,
    "noShowGraceMinutes": 15,
    "lateReinsertAfter": 3,
    "staleThresholdMinutes": 10,
}

UNDO_WINDOW_SECONDS = 10
MAX_DELAY_MINUTES = 480
MAX_QUOTED_WAIT_MINUTES = 480
SLOT_OFFER_WINDOW_MINUTES = 10

_OVER = ("ended", "cancelled")


def _is_integer(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    return isinstance(value, float) and math.isfinite(value) and value.is_integer()


# --- Session-level guards -------------------------------------------------------


def can_declare_doctor_arrived(state: QueueState) -> GuardResult:
    if state["status"] in _OVER:
        return _deny("SESSION_ENDED", "This session has already ended.")
    if state["doctorArrivedAt"] is not None:
        return _deny("DOCTOR_ALREADY_ARRIVED", "The doctor is already recorded as arrived.")
    return ALLOWED


def can_declare_delay(state: QueueState, minutes: Any) -> GuardResult:
    if state["status"] in _OVER:
        return _deny("SESSION_ENDED", "This session has already ended.")
    if not _is_integer(minutes) or minutes <= 0 or minutes > MAX_DELAY_MINUTES:
        return _deny(
            "DELAY_OUT_OF_RANGE", f"A delay must be between 1 and {MAX_DELAY_MINUTES} minutes."
        )
    return ALLOWED


def can_pause(state: QueueState) -> GuardResult:
    if state["status"] == "paused":
        return _deny("ALREADY_PAUSED", "This session is already paused.")
    if state["status"] != "running":
        return _deny("SESSION_NOT_RUNNING", "A session can only be paused while it is running.")
    return ALLOWED


def can_resume(state: QueueState) -> GuardResult:
    if state["status"] != "paused":
        return _deny("NOT_PAUSED", "This session is not paused.")
    return ALLOWED


# --- What a console may replay (BACKEND.md §5) ------------------------------------

OFFLINE_ACTION_ROLES: dict[str, tuple[str, ...]] = {
    "DOCTOR_ARRIVED": ("receptionist", "doctor"),
    "DELAY_DECLARED": ("receptionist", "doctor"),
    "SESSION_PAUSED": ("receptionist",),
    "SESSION_RESUMED": ("receptionist",),
    "PATIENT_CALLED": ("receptionist", "doctor"),
    "PATIENT_DONE": ("receptionist", "doctor"),
    "PATIENT_LATE": ("receptionist",),
    "PATIENT_NO_SHOW": ("receptionist",),
    "PATIENT_REINSERTED": ("receptionist",),
    "PATIENT_ARRIVED": ("receptionist",),
    "PRIORITY_REORDERED": ("receptionist",),
}


def can_replay_offline(kind: str, roles: tuple[str, ...] | list[str]) -> GuardResult:
    allowed = OFFLINE_ACTION_ROLES.get(kind)
    if allowed is None:
        return _deny(
            "NOT_AN_OFFLINE_ACTION",
            f"{kind} cannot be replayed from a console's queue. It has its own route.",
        )
    if not any(role in allowed for role in roles):
        return _deny("ROLE_NOT_ALLOWED", f"{kind} is not an action this role may take.")
    return ALLOWED


# --- Calling the next patient ------------------------------------------------------


def can_call_next(state: QueueState) -> GuardResult:
    if state["status"] in _OVER:
        return _deny("SESSION_ENDED", "This session has already ended.")
    if state["status"] == "paused":
        return _deny("SESSION_NOT_RUNNING", "This session is paused. Resume it first.")
    if state["doctorArrivedAt"] is None:
        return _deny("SESSION_NOT_RUNNING", "Mark the doctor as arrived before calling a patient.")
    serving = now_serving(state)
    if serving is not None:
        return _deny(
            "PATIENT_IN_CHAMBER",
            f"Serial {js_str(serving['serial'])} is still in the chamber. Finish that consultation first.",
        )
    if next_to_call(state) is None:
        return _deny("QUEUE_EMPTY", "Nobody is waiting.")
    return ALLOWED


def next_to_call(state: QueueState) -> QueueEntry | None:
    waiting = waiting_queue(state)
    first_not_late = next((e for e in waiting if e["status"] != "late"), None)
    if first_not_late is not None:
        return first_not_late
    return waiting[0] if waiting else None


# --- Ending a chamber ----------------------------------------------------------------


def can_end_session(state: QueueState) -> GuardResult:
    if state["status"] in _OVER:
        return _deny("SESSION_ENDED", "This session has already ended.")
    serving = now_serving(state)
    if serving is not None:
        return _deny(
            "PATIENT_IN_CHAMBER",
            f"Serial {js_str(serving['serial'])} is still in the chamber. Finish that consultation first.",
        )
    return ALLOWED


def unseen_at_end(state: QueueState) -> int:
    return len(waiting_queue(state))


def can_mark_done(state: QueueState, booking_id: str) -> GuardResult:
    entry = find_entry(state, booking_id)
    if entry is None:
        return _deny("UNKNOWN_BOOKING", "That booking is not in this session.")
    if entry["status"] != "in_chamber":
        return _deny(
            "BOOKING_SETTLED",
            f"Serial {js_str(entry['serial'])} is not in the chamber, so there is nothing to finish.",
        )
    return ALLOWED


# --- Late, no-show and recovery --------------------------------------------------------


def can_mark_no_show(state: QueueState, booking_id: str, settings: dict[str, Any], now: str) -> GuardResult:
    entry = find_entry(state, booking_id)
    if entry is None:
        return _deny("UNKNOWN_BOOKING", "That booking is not in this session.")
    if entry["status"] == "no_show":
        return _deny("BOOKING_SETTLED", "That patient is already marked absent.")
    if entry["status"] in ("done", "cancelled", "rescheduled"):
        return _deny("BOOKING_SETTLED", "That booking has already been settled.")
    if state["status"] == "paused":
        return _deny("SESSION_NOT_RUNNING", "This session is paused. Resume it first.")
    grace = grace_remaining(state, booking_id, settings, now)
    if grace is None:
        return _deny("NOT_A_NO_SHOW", "That patient has not been reached yet.")
    if grace["minutesRemaining"] > 0:
        return _deny(
            "NO_SHOW_BEFORE_GRACE",
            f"Grace period is still running: {js_str(grace['minutesRemaining'])} more minute(s) of "
            f"{js_str(grace['windowMinutes'])}.",
        )
    return ALLOWED


def grace_window_minutes(state: QueueState, settings: dict[str, Any]) -> float:
    """The longer of "N patients at the current pace" and "M minutes" (FR-QUE-20)."""
    rate_minutes = current_rate_seconds(state["rate"]) / 60
    return max(settings["noShowGraceMinutes"], settings["noShowGracePatients"] * rate_minutes)


def grace_remaining(
    state: QueueState, booking_id: str, settings: dict[str, Any], now: str
) -> dict[str, Any] | None:
    turn_at = _turn_reached_at(state, booking_id)
    if turn_at is None:
        return None
    window = math.ceil(grace_window_minutes(state, settings))
    elapsed = difference_in_minutes(now, turn_at)
    return {"minutesRemaining": max(0, window - elapsed), "windowMinutes": window, "turnReachedAt": turn_at}


def _turn_reached_at(state: QueueState, booking_id: str) -> str | None:
    queue = active_queue(state)
    position = next((i for i, e in enumerate(queue) if e["bookingId"] == booking_id), -1)
    if position != 0:
        return None
    departures: list[str] = []
    for entry in state["entries"]:
        if entry["doneAt"] is not None:
            departures.append(entry["doneAt"])
        if entry["noShow"] is not None:
            departures.append(entry["noShow"]["markedAt"])
    if state["doctorArrivedAt"] is not None:
        departures.append(state["doctorArrivedAt"])
    if state["hold"] is not None:
        departures.append(state["hold"]["until"])
    if state["resumedAt"] is not None:
        departures.append(state["resumedAt"])
    if not departures:
        return None
    latest = departures[0]
    for candidate in departures[1:]:
        if candidate > latest:
            latest = candidate
    return latest


def can_check_in(state: QueueState, booking_id: str, quoted_wait_minutes: Any) -> GuardResult:
    if state["status"] in _OVER:
        return _deny("SESSION_ENDED", "This session has already ended.")
    entry = find_entry(state, booking_id)
    if entry is None:
        return _deny("UNKNOWN_BOOKING", "That booking is not in this session.")
    if entry["status"] in ("done", "cancelled", "rescheduled", "no_show"):
        return _deny("BOOKING_SETTLED", "That booking has already been settled.")
    if entry["status"] == "in_chamber" or entry["arrivedAt"] is not None:
        return _deny("ALREADY_ARRIVED", "That patient is already here.")
    if (
        not _is_integer(quoted_wait_minutes)
        or quoted_wait_minutes < 0
        or quoted_wait_minutes > MAX_QUOTED_WAIT_MINUTES
    ):
        return _deny(
            "QUOTE_OUT_OF_RANGE",
            f"A quoted wait is a whole number of minutes from 0 to {MAX_QUOTED_WAIT_MINUTES}.",
        )
    return ALLOWED


def can_reinstate(state: QueueState, booking_id: str) -> GuardResult:
    entry = find_entry(state, booking_id)
    if entry is None:
        return _deny("UNKNOWN_BOOKING", "That booking is not in this session.")
    if entry["status"] not in ("no_show", "late"):
        return _deny(
            "NOT_A_NO_SHOW", "Only a patient marked absent or late can be brought back into the queue."
        )
    if state["status"] in _OVER:
        return _deny("SESSION_ENDED", "This session has already ended.")
    return ALLOWED


def can_declare_late(state: QueueState, booking_id: str) -> GuardResult:
    entry = find_entry(state, booking_id)
    if entry is None:
        return _deny("UNKNOWN_BOOKING", "That booking is not in this session.")
    if entry["status"] == "in_chamber":
        return _deny("PATIENT_IN_CHAMBER", "That patient is already in the chamber.")
    if entry["status"] in ("done", "cancelled", "rescheduled"):
        return _deny("BOOKING_SETTLED", "That booking has already been settled.")
    if state["status"] in _OVER:
        return _deny("SESSION_ENDED", "This session has already ended.")
    return ALLOWED


def late_reinsert_index(state: QueueState, booking_id: str, reinsert_after: int) -> int:
    queue = active_queue(state)
    current = next((i for i, e in enumerate(queue) if e["bookingId"] == booking_id), -1)
    others = [e for e in queue if e["bookingId"] != booking_id]
    start = 0 if current == -1 else current
    return min(start + max(1, reinsert_after), len(others))


def can_reorder(state: QueueState, booking_id: str, reason: str) -> GuardResult:
    entry = find_entry(state, booking_id)
    if entry is None:
        return _deny("UNKNOWN_BOOKING", "That booking is not in this session.")
    if reason.strip() == "":
        return _deny(
            "REASON_REQUIRED",
            "Moving a patient up the queue needs a reason, and it is recorded in the audit log.",
        )
    if entry["status"] in ("done", "no_show", "cancelled"):
        return _deny("BOOKING_SETTLED", "That booking has already been settled.")
    if state["status"] in _OVER:
        return _deny("SESSION_ENDED", "This session has already ended.")
    return ALLOWED


def can_add_walkin(state: QueueState, position: str, reason: str | None) -> GuardResult:
    if state["status"] in _OVER:
        return _deny("SESSION_ENDED", "This session has already ended.")
    if position == "index" and (reason is None or reason.strip() == ""):
        return _deny(
            "REASON_REQUIRED",
            "Placing a walk-in ahead of waiting patients needs a reason, and it is recorded.",
        )
    return ALLOWED


def has_capacity(state: QueueState) -> bool:
    capacity = state["plan"]["capacity"]
    if capacity is None:
        return True
    return len(active_queue(state)) < capacity


# --- Offering a freed slot (FR-QUE-30, FR-REC-30) ----------------------------------------


def can_offer_freed_slot(state: QueueState, freed_booking_id: str) -> GuardResult:
    if state["status"] in _OVER:
        return _deny("SESSION_ENDED", "This session has already ended.")
    entry = find_entry(state, freed_booking_id)
    if entry is None:
        return _deny("UNKNOWN_BOOKING", "That booking is not in this session.")
    if entry["status"] not in ("no_show", "cancelled"):
        return _deny("SLOT_NOT_FREE", "Only a cancelled booking or a marked no-show frees a slot to offer.")
    if any(offer["freedBookingId"] == freed_booking_id for offer in pending_offers(state)):
        return _deny("OFFER_OUTSTANDING", "That slot is already offered and awaiting an answer.")
    return ALLOWED


def can_accept_slot(state: QueueState, offer_id: str, now: str) -> GuardResult:
    offer = next((o for o in state["offers"] if o["offerId"] == offer_id), None)
    if offer is None:
        return _deny("UNKNOWN_OFFER", "That offer does not exist.")
    if offer["outcome"] == "accepted":
        return _deny("OFFER_SETTLED", "That slot has already been taken.")
    if offer["outcome"] == "expired":
        return _deny("OFFER_EXPIRED", "That offer has expired and the slot has moved on.")
    if difference_in_seconds(offer["expiresAt"], now) <= 0:
        return _deny("OFFER_EXPIRED", "That offer has expired and the slot has moved on.")
    if state["status"] in _OVER:
        return _deny("SESSION_ENDED", "This session has already ended.")
    return ALLOWED


def lapsed_offers(state: QueueState, now: str) -> list[dict[str, Any]]:
    return [o for o in pending_offers(state) if difference_in_seconds(o["expiresAt"], now) <= 0]
