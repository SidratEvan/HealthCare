"""A session's queue, and how one comes into existence (port of `queue/state.ts`).

    seed (session plan + roster of bookings) + events => state

The seed uses only immutable booking facts; `status` is what the events
decide. `entries` is the queue in the order staff see it, settled rows
included; `active_queue` is what every ETA is computed from.
"""

from __future__ import annotations

from functools import cmp_to_key
from typing import Any

from ..enums import is_active_booking_status

QueueState = dict[str, Any]
QueueEntry = dict[str, Any]


def _compare_roster(a: dict[str, Any], b: dict[str, Any]) -> int:
    """Serial order, with creation time and then id as tie-breaks."""
    if a["serial"] != b["serial"]:
        return -1 if a["serial"] < b["serial"] else 1
    if a["createdAt"] != b["createdAt"]:
        return -1 if a["createdAt"] < b["createdAt"] else 1
    if a["bookingId"] < b["bookingId"]:
        return -1
    if a["bookingId"] > b["bookingId"]:
        return 1
    return 0


def empty_state(seed: dict[str, Any]) -> QueueState:
    """Before anything has happened: every booking `booked`, in serial order."""
    roster = sorted(seed["roster"], key=cmp_to_key(_compare_roster))
    entries = [
        {
            "bookingId": booking["bookingId"],
            "serial": booking["serial"],
            "patientId": booking["patientId"],
            "source": booking["source"],
            "status": "booked",
            "arrivedAt": None,
            "quotedWaitMinutes": None,
            "calledAt": None,
            "doneAt": None,
            "consultSeconds": None,
            "late": None,
            "noShow": None,
            "cancelled": None,
            "priority": None,
        }
        for booking in roster
    ]
    plan = seed["plan"]
    return {
        "plan": plan,
        "status": "scheduled",
        "openedAt": None,
        "doctorArrivedAt": None,
        "endedAt": None,
        "delayMinutes": 0,
        "hold": None,
        "pausedAt": None,
        "pausedSeconds": 0,
        "resumedAt": None,
        "entries": entries,
        "rate": {
            "seedSeconds": plan["defaultConsultSeconds"],
            "currentSeconds": plan["defaultConsultSeconds"],
            "samples": [],
        },
        "offers": [],
        "lastSeq": 0,
        "lastEventAt": None,
        "undoneEventIds": [],
        "anomalies": [],
    }


# --- Selectors ---------------------------------------------------------------


def now_serving(state: QueueState) -> QueueEntry | None:
    """The patient in the chamber, if there is one. At most one (FR-QUE-53)."""
    return next((e for e in state["entries"] if e["status"] == "in_chamber"), None)


def active_queue(state: QueueState) -> list[QueueEntry]:
    return [e for e in state["entries"] if is_active_booking_status(e["status"])]


def waiting_queue(state: QueueState) -> list[QueueEntry]:
    return [
        e
        for e in state["entries"]
        if is_active_booking_status(e["status"]) and e["status"] != "in_chamber"
    ]


def find_entry(state: QueueState, booking_id: str) -> QueueEntry | None:
    return next((e for e in state["entries"] if e["bookingId"] == booking_id), None)


def index_of_entry(state: QueueState, booking_id: str) -> int:
    for index, entry in enumerate(state["entries"]):
        if entry["bookingId"] == booking_id:
            return index
    return -1


def patients_ahead(state: QueueState, booking_id: str) -> int:
    queue = active_queue(state)
    for position, entry in enumerate(queue):
        if entry["bookingId"] == booking_id:
            return position
    return 0


def queue_counts(state: QueueState) -> dict[str, int]:
    waiting = in_chamber = late = no_show = done = cancelled = 0
    for entry in state["entries"]:
        status = entry["status"]
        if status in ("booked", "waiting"):
            waiting += 1
        elif status == "in_chamber":
            in_chamber += 1
        elif status == "late":
            late += 1
        elif status == "no_show":
            no_show += 1
        elif status == "done":
            done += 1
        elif status in ("cancelled", "rescheduled"):
            cancelled += 1
    return {
        "waiting": waiting,
        "inChamber": in_chamber,
        "late": late,
        "noShow": no_show,
        "done": done,
        "cancelled": cancelled,
        "total": len(state["entries"]),
    }


def pending_offers(state: QueueState) -> list[dict[str, Any]]:
    return [o for o in state["offers"] if o["outcome"] == "pending"]


def project(state: QueueState) -> dict[str, Any]:
    """What is written to `queue_state` (DATABASE.md §2.3)."""
    serving = now_serving(state)
    counts = queue_counts(state)
    return {
        "sessionId": state["plan"]["sessionId"],
        "nowServingBookingId": serving["bookingId"] if serving else None,
        "nowServingSerial": serving["serial"] if serving else None,
        "waitingCount": counts["waiting"],
        "lateCount": counts["late"],
        "noShowCount": counts["noShow"],
        "doneCount": counts["done"],
        "avgConsultSeconds": state["rate"]["currentSeconds"] if state["rate"]["samples"] else None,
        "rebuiltFromSeq": state["lastSeq"],
    }


def check_invariants(state: QueueState) -> list[str]:
    problems: list[str] = []
    in_chamber = [e for e in state["entries"] if e["status"] == "in_chamber"]
    if len(in_chamber) > 1:
        problems.append(
            f"{len(in_chamber)} patients are in the chamber at once; only one may be (FR-QUE-53)."
        )
    seen: set[str] = set()
    for entry in state["entries"]:
        if entry["bookingId"] in seen:
            problems.append(f"Booking {entry['bookingId']} appears twice in the queue.")
        seen.add(entry["bookingId"])
    if state["status"] == "running" and state["doctorArrivedAt"] is None:
        problems.append("Session is running but no doctor has arrived (sessions_running_has_started).")
    if state["status"] == "paused" and state["pausedAt"] is None:
        problems.append("Session is paused but has no pause start.")
    if state["delayMinutes"] < 0:
        problems.append(f"Cumulative delay is negative: {state['delayMinutes']}.")
    if state["pausedSeconds"] < 0:
        problems.append(f"Accumulated pause time is negative: {state['pausedSeconds']}.")
    for entry in state["entries"]:
        if entry["status"] == "done" and entry["doneAt"] is None:
            problems.append(f"Booking {entry['bookingId']} is done but has no completion time.")
        if entry["status"] == "in_chamber" and entry["calledAt"] is None:
            problems.append(f"Booking {entry['bookingId']} is in the chamber but was never called.")
        if entry["status"] == "late" and entry["late"] is None:
            problems.append(f"Booking {entry['bookingId']} is late but has no lateness declaration.")
        if entry["status"] == "no_show" and entry["noShow"] is None:
            problems.append(f"Booking {entry['bookingId']} is a no-show but has no grace record.")
    return problems
