"""`(state, event) -> state`. The core function of the product (port of `queue/reducer.ts`).

The one definition of what a queue event means. Pure (no clock, no
randomness, no I/O), total (every event type), non-throwing (a log naming an
unknown booking records an anomaly and carries on). Guards live in
`rules.py`; an event already in the log is a fact and folds the same way
whatever a guard would now say.

Held to the TypeScript reducer by `tests/domain/test_queue_parity.py`, which
replays the same logs through both and compares the states.
"""

from __future__ import annotations

from typing import Any

from ..jsfmt import js_str
from ..time import add_seconds, difference_in_seconds
from .rate import observe_consult
from .state import QueueEntry, QueueState, find_entry, now_serving

QueueEvent = dict[str, Any]

MAX_SAFE_INTEGER = 9_007_199_254_740_991


def reduce(state: QueueState, event: QueueEvent) -> QueueState:
    # Already accounted for: the fold is idempotent (FR-QUE-51, SY-02).
    if state["lastSeq"] > 0 and event["seq"] <= state["lastSeq"]:
        return state

    # An event compensated by a later ACTION_UNDONE never happened (GR-02).
    if event["id"] in state["undoneEventIds"]:
        return _advance(state, event)

    kind = event["type"]
    payload = event["payload"]

    if kind == "SESSION_OPENED":
        return _advance(
            {
                **state,
                "openedAt": state["openedAt"] if state["openedAt"] is not None else event["serverTs"],
                "status": "scheduled" if state["status"] == "scheduled" else state["status"],
            },
            event,
        )

    if kind == "DOCTOR_ARRIVED":
        return _advance(
            {
                **state,
                "doctorArrivedAt": payload["arrivedAt"],
                "status": "running" if state["status"] == "scheduled" else state["status"],
            },
            event,
        )

    if kind == "DELAY_DECLARED":
        minutes = max(0, payload["minutes"])
        return _advance(
            {
                **state,
                "delayMinutes": state["delayMinutes"] + minutes,
                "hold": state["hold"]
                if state["doctorArrivedAt"] is None
                else _extend_hold(state["hold"], event["serverTs"], minutes),
            },
            event,
        )

    if kind == "SESSION_PAUSED":
        return _advance({**state, "status": "paused", "pausedAt": event["serverTs"]}, event)

    if kind == "SESSION_RESUMED":
        paused = state["pausedAt"]
        return _advance(
            {
                **state,
                "status": "scheduled" if state["doctorArrivedAt"] is None else "running",
                "pausedAt": None,
                "resumedAt": state["resumedAt"] if paused is None else event["serverTs"],
                "pausedSeconds": state["pausedSeconds"]
                if paused is None
                else state["pausedSeconds"] + max(0, difference_in_seconds(event["serverTs"], paused)),
            },
            event,
        )

    if kind == "PATIENT_CALLED":
        return _reduce_called(state, event)
    if kind == "PATIENT_DONE":
        return _reduce_done(state, event)
    if kind == "PATIENT_LATE":
        return _reduce_late(state, event)
    if kind == "PATIENT_NO_SHOW":
        return _reduce_no_show(state, event)
    if kind == "PATIENT_REINSERTED":
        return _reduce_reinserted(state, event)
    if kind == "PATIENT_ARRIVED":
        return _reduce_arrived(state, event)
    if kind == "WALKIN_ADDED":
        return _reduce_walkin(state, event)
    if kind == "BOOKING_CANCELLED":
        return _reduce_cancelled(state, event)

    if kind == "SLOT_OFFERED":
        return _advance(
            {
                **state,
                "offers": [
                    *state["offers"],
                    {
                        "offerId": payload["offerId"],
                        "freedBookingId": payload["freedBookingId"],
                        "offeredTo": payload["offeredTo"],
                        "offeredAt": event["serverTs"],
                        "expiresAt": payload["expiresAt"],
                        "outcome": "pending",
                        "acceptedBookingId": None,
                    },
                ],
            },
            event,
        )

    if kind == "SLOT_ACCEPTED":
        return _reduce_slot_accepted(state, event)
    if kind == "SLOT_EXPIRED":
        return _reduce_slot_outcome(state, event, payload["offerId"], "expired", None)
    if kind == "PRIORITY_REORDERED":
        return _reduce_reordered(state, event)

    if kind == "SESSION_ENDED":
        return _advance(
            {**state, "status": "ended", "endedAt": event["serverTs"], "pausedAt": None}, event
        )

    if kind == "ACTION_UNDONE":
        return _advance(
            {**state, "undoneEventIds": _insert_sorted(state["undoneEventIds"], payload["undoneEventId"])},
            event,
        )

    raise ValueError(f"unknown queue event type {kind}")


# ---------------------------------------------------------------------------
# Per-event handlers
# ---------------------------------------------------------------------------


def _extend_hold(current: dict[str, Any] | None, at: str, minutes: int) -> dict[str, Any]:
    if current is not None and current["until"] > at:
        return {"until": add_seconds(current["until"], minutes * 60), "minutes": current["minutes"] + minutes}
    return {"until": add_seconds(at, minutes * 60), "minutes": minutes}


def _reduce_called(state: QueueState, event: QueueEvent) -> QueueState:
    booking_id = event["payload"]["bookingId"]
    entry = find_entry(state, booking_id)
    if entry is None:
        return _with_anomaly(state, event, "UNKNOWN_BOOKING", booking_id)

    serving = now_serving(state)
    displaced = (
        _with_anomaly(
            state,
            event,
            "DUPLICATE_CALL",
            serving["bookingId"],
            f"Serial {js_str(serving['serial'])} was still in the chamber when serial "
            f"{js_str(entry['serial'])} was called.",
        )
        if serving is not None and serving["bookingId"] != booking_id
        else state
    )

    def change(current: QueueEntry) -> QueueEntry:
        if current["bookingId"] == booking_id:
            return {**current, "status": "in_chamber", "calledAt": event["serverTs"]}
        if current["status"] == "in_chamber":
            return {**current, "status": "waiting"}
        return current

    return _advance(_map_entries(displaced, change), event)


def _reduce_done(state: QueueState, event: QueueEvent) -> QueueState:
    booking_id = event["payload"]["bookingId"]
    consult_seconds = event["payload"]["consultSeconds"]
    if find_entry(state, booking_id) is None:
        return _with_anomaly(state, event, "UNKNOWN_BOOKING", booking_id)
    following = _map_entries(
        state,
        lambda current: {
            **current,
            "status": "done",
            "doneAt": event["serverTs"],
            "consultSeconds": consult_seconds,
            "late": None,
        }
        if current["bookingId"] == booking_id
        else current,
    )
    return _advance({**following, "rate": observe_consult(state["rate"], consult_seconds)}, event)


def _reduce_late(state: QueueState, event: QueueEvent) -> QueueState:
    payload = event["payload"]
    booking_id = payload["bookingId"]
    if find_entry(state, booking_id) is None:
        return _with_anomaly(state, event, "UNKNOWN_BOOKING", booking_id)
    marked = _map_entries(
        state,
        lambda current: {
            **current,
            "status": "late",
            "late": {
                "declaredAt": event["serverTs"],
                "expectedMinutes": payload["expectedMinutes"],
                "reinsertAfter": payload["reinsertAfter"],
            },
        }
        if current["bookingId"] == booking_id
        else current,
    )
    return _advance(_move_after_active_patients(marked, booking_id, payload["reinsertAfter"]), event)


def _reduce_no_show(state: QueueState, event: QueueEvent) -> QueueState:
    payload = event["payload"]
    booking_id = payload["bookingId"]
    if find_entry(state, booking_id) is None:
        return _with_anomaly(state, event, "UNKNOWN_BOOKING", booking_id)
    return _advance(
        _map_entries(
            state,
            lambda current: {
                **current,
                "status": "no_show",
                "noShow": {"markedAt": event["serverTs"], "graceUsedMinutes": payload["graceUsedMinutes"]},
                "late": None,
            }
            if current["bookingId"] == booking_id
            else current,
        ),
        event,
    )


def _reduce_reinserted(state: QueueState, event: QueueEvent) -> QueueState:
    payload = event["payload"]
    booking_id = payload["bookingId"]
    if find_entry(state, booking_id) is None:
        return _with_anomaly(state, event, "UNKNOWN_BOOKING", booking_id)
    restored = _map_entries(
        state,
        lambda current: {**current, "status": "waiting", "noShow": None, "late": None}
        if current["bookingId"] == booking_id
        else current,
    )
    return _advance(_move_to_active_index(restored, booking_id, payload["newPosition"]), event)


def _reduce_arrived(state: QueueState, event: QueueEvent) -> QueueState:
    payload = event["payload"]
    booking_id = payload["bookingId"]
    if find_entry(state, booking_id) is None:
        return _with_anomaly(state, event, "UNKNOWN_BOOKING", booking_id)

    def change(current: QueueEntry) -> QueueEntry:
        if current["bookingId"] != booking_id or current["arrivedAt"] is not None:
            return current
        present = current["status"] in ("booked", "late")
        return {
            **current,
            "status": "waiting" if present else current["status"],
            "late": None if present else current["late"],
            "arrivedAt": event["serverTs"],
            "quotedWaitMinutes": payload["quotedWaitMinutes"],
        }

    return _advance(_map_entries(state, change), event)


def _reduce_walkin(state: QueueState, event: QueueEvent) -> QueueState:
    payload = event["payload"]
    booking_id = payload["bookingId"]
    if find_entry(state, booking_id) is None:
        return _with_anomaly(
            state,
            event,
            "UNKNOWN_BOOKING",
            booking_id,
            "A walk-in was added that is not in this roster. Reload the session.",
        )
    admitted = _map_entries(
        state,
        lambda current: {**current, "status": "waiting", "arrivedAt": event["serverTs"]}
        if current["bookingId"] == booking_id
        else current,
    )
    if payload["position"] == "end" or payload["index"] is None:
        return _advance(_move_to_end(admitted, booking_id), event)
    return _advance(_move_to_active_index(admitted, booking_id, payload["index"]), event)


def _reduce_cancelled(state: QueueState, event: QueueEvent) -> QueueState:
    payload = event["payload"]
    booking_id = payload["bookingId"]
    if find_entry(state, booking_id) is None:
        return _with_anomaly(state, event, "UNKNOWN_BOOKING", booking_id)
    return _advance(
        _map_entries(
            state,
            lambda current: {
                **current,
                "status": "cancelled",
                "late": None,
                "cancelled": {"cancelledAt": event["serverTs"], "reason": payload["reason"]},
            }
            if current["bookingId"] == booking_id
            else current,
        ),
        event,
    )


def _reduce_slot_accepted(state: QueueState, event: QueueEvent) -> QueueState:
    payload = event["payload"]
    new_booking_id = payload["newBookingId"]
    with_outcome = _reduce_slot_outcome(state, event, payload["offerId"], "accepted", new_booking_id)
    if find_entry(with_outcome, new_booking_id) is None:
        return _with_anomaly(
            with_outcome,
            event,
            "UNKNOWN_BOOKING",
            new_booking_id,
            "A slot was accepted by a booking that is not in this roster. Reload the session.",
            then_advance=False,
        )
    return _map_entries(
        with_outcome,
        lambda current: {**current, "status": "waiting"} if current["bookingId"] == new_booking_id else current,
    )


def _reduce_slot_outcome(
    state: QueueState,
    event: QueueEvent,
    offer_id: str,
    outcome: str,
    accepted_booking_id: str | None,
) -> QueueState:
    known = any(offer["offerId"] == offer_id for offer in state["offers"])
    base = (
        state
        if known
        else _with_anomaly(
            state,
            event,
            "UNKNOWN_OFFER",
            None,
            f"Offer {js_str(offer_id)} was resolved but never made.",
            then_advance=False,
        )
    )
    return _advance(
        {
            **base,
            "offers": [
                {**offer, "outcome": outcome, "acceptedBookingId": accepted_booking_id}
                if offer["offerId"] == offer_id and offer["outcome"] == "pending"
                else offer
                for offer in base["offers"]
            ],
        },
        event,
    )


def _reduce_reordered(state: QueueState, event: QueueEvent) -> QueueState:
    payload = event["payload"]
    booking_id = payload["bookingId"]
    if find_entry(state, booking_id) is None:
        return _with_anomaly(state, event, "UNKNOWN_BOOKING", booking_id)
    marked = _map_entries(
        state,
        lambda current: {**current, "priority": {"movedAt": event["serverTs"], "reason": payload["reason"]}}
        if current["bookingId"] == booking_id
        else current,
    )
    return _advance(_move_to_active_index(marked, booking_id, payload["toIndex"]), event)


# ---------------------------------------------------------------------------
# Ordering helpers: positions an event quotes are positions in the active queue
# ---------------------------------------------------------------------------


def _is_active(entry: QueueEntry) -> bool:
    return entry["status"] in ("booked", "waiting", "in_chamber", "late")


def _move_to_active_index(state: QueueState, booking_id: str, active_index: int) -> QueueState:
    entries = state["entries"]
    source = next((i for i, e in enumerate(entries) if e["bookingId"] == booking_id), -1)
    if source == -1:
        return state
    moving = entries[source]
    without = [*entries[:source], *entries[source + 1 :]]
    target = max(0, min(active_index, _count_active(without)))
    active = 0
    insert_at = len(without)
    for index, candidate in enumerate(without):
        if _is_active(candidate):
            if active == target:
                insert_at = index
                break
            active += 1
    return {**state, "entries": [*without[:insert_at], moving, *without[insert_at:]]}


def _move_after_active_patients(state: QueueState, booking_id: str, count: int) -> QueueState:
    active_entries = [e for e in state["entries"] if _is_active(e)]
    current = next((i for i, e in enumerate(active_entries) if e["bookingId"] == booking_id), -1)
    start = 0 if current == -1 else current
    return _move_to_active_index(state, booking_id, start + max(1, count))


def _move_to_end(state: QueueState, booking_id: str) -> QueueState:
    return _move_to_active_index(state, booking_id, MAX_SAFE_INTEGER)


def _count_active(entries: list[QueueEntry]) -> int:
    return sum(1 for e in entries if _is_active(e))


# ---------------------------------------------------------------------------
# Bookkeeping
# ---------------------------------------------------------------------------


def _map_entries(state: QueueState, change: Any) -> QueueState:
    return {**state, "entries": [change(entry) for entry in state["entries"]]}


def _advance(state: QueueState, event: QueueEvent) -> QueueState:
    return {
        **state,
        "lastSeq": max(state["lastSeq"], event["seq"]),
        "lastEventAt": _later_of(state["lastEventAt"], event["serverTs"]),
    }


def _later_of(current: str | None, candidate: str) -> str:
    if current is None:
        return candidate
    return candidate if candidate > current else current


def _with_anomaly(
    state: QueueState,
    event: QueueEvent,
    code: str,
    booking_id: str | None,
    detail: str | None = None,
    then_advance: bool = True,
) -> QueueState:
    anomaly = {
        "code": code,
        "eventId": event["id"],
        "seq": event["seq"],
        "detail": detail
        if detail is not None
        else f"{event['type']} referenced booking {js_str(booking_id)}, which is not in this session's roster.",
    }
    following = {**state, "anomalies": [*state["anomalies"], anomaly]}
    return _advance(following, event) if then_advance else following


def _insert_sorted(ids: list[str], new_id: str) -> list[str]:
    if new_id in ids:
        return ids
    return sorted([*ids, new_id], key=_js_sort_key)


def _js_sort_key(value: str) -> list[int]:
    """`Array.prototype.sort()`'s default order: UTF-16 code units."""
    return list(value.encode("utf-16-be"))
