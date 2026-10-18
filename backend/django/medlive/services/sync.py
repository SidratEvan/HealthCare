"""A console's offline queue, replayed (port of `services/sync.service.ts`; SY-01..08, FR-OFF-01, FR-QUE-51).

A batch is applied in the order the console recorded it, each action once
(by its `clientEventId`), and an action that lost to the server's state is a
conflict to show, not an error. A device away longer than a day pulls the
whole state rather than the events it missed.
"""

from __future__ import annotations

import functools
import math
from typing import Any

from ..core.errors import validation_failed
from ..domain.queue.rate import clamp_consult_seconds
from ..domain.queue.rules import can_replay_offline
from ..domain.time import (
    difference_in_hours,
    difference_in_minutes,
    from_datetime,
    from_epoch_ms,
    is_after,
    now_iso,
    parse_ms,
)
from . import queue as queue_service

MAX_OFFLINE_HOURS = 24


def push_batch(*, session_id: str, actor: dict[str, Any], roles: list[str], entries: list[dict[str, Any]]) -> dict[str, Any]:
    ordered = sorted(entries, key=functools.cmp_to_key(_by_client_timestamp))
    _assert_no_duplicate_keys(ordered)
    accepted: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    replayable: list[dict[str, Any]] = []
    for entry in ordered:
        allowed = can_replay_offline(entry["type"], roles)
        if allowed["ok"]:
            replayable.append(entry)
        else:
            conflicts.append({"clientEventId": entry["clientEventId"], "reason": allowed["detail"], "code": allowed["code"]})
    planned_start = (
        from_datetime(queue_service.require_session(session_id)["plannedStart"])
        if any(entry["type"] == "DOCTOR_ARRIVED" for entry in replayable)
        else None
    )
    now = now_iso()
    prepared = [_with_plausible_payload(entry) for entry in replayable]
    if planned_start is not None:
        prepared = [_with_server_lateness(entry, planned_start, now) for entry in prepared]
    result = queue_service.append_batch(session_id=session_id, actor=actor, entries=prepared)
    for outcome in result["outcomes"]:
        if outcome["kind"] == "accepted":
            accepted.append({"clientEventId": outcome["clientEventId"], "seq": outcome["seq"], "eventId": outcome["eventId"]})
        else:
            conflicts.append({"clientEventId": outcome["clientEventId"], "reason": outcome["reason"], "code": outcome["code"]})
    return {
        "accepted": accepted,
        "conflicts": conflicts,
        "state": result["state"],
        "etas": result["etas"],
        "seq": result["seq"],
        "serverTs": result["serverTs"],
    }


def pull_since(*, session_id: str, since_seq: int, last_synced_at: str | None = None) -> dict[str, Any]:
    state = queue_service.get_state(session_id)
    etas = queue_service.get_etas(session_id)
    server_ts = now_iso()
    full_resync = requires_full_resync(since_seq, last_synced_at, server_ts)
    return {
        "events": [] if full_resync else queue_service.events_since(session_id, since_seq),
        "state": state,
        "etas": etas,
        "seq": state["lastSeq"],
        "serverTs": server_ts,
        "fullResync": full_resync,
    }


def requires_full_resync(since_seq: int, last_synced_at: str | None, now: str) -> bool:
    if since_seq <= 0 or last_synced_at is None:
        return True
    return difference_in_hours(now, last_synced_at) >= MAX_OFFLINE_HOURS


def _with_plausible_payload(entry: dict[str, Any]) -> dict[str, Any]:
    measured = entry["payload"].get("consultSeconds")
    if not isinstance(measured, (int, float)) or isinstance(measured, bool):
        return entry
    return {**entry, "payload": {**entry["payload"], "consultSeconds": clamp_consult_seconds(measured)}}


def plausible_arrival(claimed: Any, now: str) -> str:
    """When the doctor arrived, by the console's word if it is believable."""
    if not isinstance(claimed, str):
        return now
    at = parse_ms(claimed)
    if not math.isfinite(at):
        return now
    arrived_at = from_epoch_ms(at)
    if is_after(arrived_at, now):
        return now
    return now if difference_in_hours(now, arrived_at) >= MAX_OFFLINE_HOURS else arrived_at


def _with_server_lateness(entry: dict[str, Any], planned_start: str, now: str) -> dict[str, Any]:
    if entry["type"] != "DOCTOR_ARRIVED":
        return entry
    arrived_at = plausible_arrival(entry["payload"].get("arrivedAt"), now)
    return {
        **entry,
        "payload": {
            **entry["payload"],
            "arrivedAt": arrived_at,
            "minutesLate": difference_in_minutes(arrived_at, planned_start),
        },
    }


def _by_client_timestamp(a: dict[str, Any], b: dict[str, Any]) -> int:
    if a["clientTs"] == b["clientTs"]:
        return -1 if a["clientEventId"] < b["clientEventId"] else 1
    if a["clientTs"] is None:
        return 1
    if b["clientTs"] is None:
        return -1
    return -1 if a["clientTs"] < b["clientTs"] else 1


def _assert_no_duplicate_keys(entries: list[dict[str, Any]]) -> None:
    seen: set[str] = set()
    for entry in entries:
        if entry["clientEventId"] in seen:
            raise validation_failed(
                {"field": "events", "reason": f"clientEventId {entry['clientEventId']} appears twice in one batch."}
            )
        seen.add(entry["clientEventId"])
