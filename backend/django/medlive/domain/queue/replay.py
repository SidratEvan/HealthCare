"""`events -> state`, the canonical way to derive a queue (port of `queue/replay.ts`).

Replay sees the whole log before folding any of it, so an `ACTION_UNDONE`
at the end suppresses the event it compensates at the beginning (GR-02).
"""

from __future__ import annotations

from functools import cmp_to_key
from typing import Any

from .reducer import _js_sort_key, reduce
from .state import QueueState, empty_state

QueueEvent = dict[str, Any]


def replay(seed: dict[str, Any], events: list[QueueEvent]) -> QueueState:
    return continue_replay(empty_state(seed), events)


def continue_replay(state: QueueState, events: list[QueueEvent]) -> QueueState:
    ordered = order_events(events)
    undone = _collect_undone_ids(ordered)
    seeded = (
        state
        if not undone
        else {**state, "undoneEventIds": _merge_sorted(state["undoneEventIds"], undone)}
    )
    current = seeded
    for event in ordered:
        current = reduce(current, event)
    return current


def needs_full_rebuild(state: QueueState, events: list[QueueEvent]) -> bool:
    ids_in_batch = {event["id"] for event in events}
    return any(
        undone_id not in ids_in_batch and undone_id not in state["undoneEventIds"]
        for undone_id in _collect_undone_ids(events)
    )


def _compare(a: QueueEvent, b: QueueEvent) -> int:
    if a["seq"] != b["seq"]:
        return -1 if a["seq"] < b["seq"] else 1
    if a["id"] < b["id"]:
        return -1
    if a["id"] > b["id"]:
        return 1
    return 0


def order_events(events: list[QueueEvent]) -> list[QueueEvent]:
    """By the server's sequence, then id (a stable total order, as `Array.sort`)."""
    return sorted(events, key=cmp_to_key(_compare))


def _collect_undone_ids(events: list[QueueEvent]) -> list[str]:
    return [e["payload"]["undoneEventId"] for e in events if e["type"] == "ACTION_UNDONE"]


def _merge_sorted(existing: list[str], incoming: list[str]) -> list[str]:
    merged: list[str] = []
    for value in [*existing, *incoming]:
        if value not in merged:
            merged.append(value)
    return sorted(merged, key=_js_sort_key)


def apply_batch(state: QueueState, events: list[QueueEvent]) -> dict[str, Any]:
    """Folds an offline batch; which events took effect, which conflicted (SY-05)."""
    before = len(state["anomalies"])
    following = continue_replay(state, events)
    new_anomalies = following["anomalies"][before:]
    accepted: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    for event in order_events(events):
        if event.get("clientEventId") is None:
            continue
        anomaly = next((a for a in new_anomalies if a["eventId"] == event["id"]), None)
        if anomaly is None:
            accepted.append({"clientEventId": event["clientEventId"], "seq": event["seq"]})
        else:
            conflicts.append({"clientEventId": event["clientEventId"], "reason": anomaly["detail"]})
    return {"state": following, "accepted": accepted, "conflicts": conflicts}
