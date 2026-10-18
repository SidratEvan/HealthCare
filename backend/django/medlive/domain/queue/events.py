"""The queue event log's shape (port of `shared/domain/src/types/events.ts`).

An event is a dict: `id`, `sessionId`, `seq`, `serverTs`, `clientTs`,
`clientEventId`, `actor`, `type`, `payload`, with the payload contracts of
DATABASE.md §3. The actor is one of
`{kind: "staff", staffUserId, role}`, `{kind: "patient", userId}`,
`{kind: "guest", bookingId}`, `{kind: "system", job}` (FR-QUE-04).
"""

from __future__ import annotations

from typing import Any

QueueEvent = dict[str, Any]

BOOKING_SCOPED_EVENT_TYPES: tuple[str, ...] = (
    "PATIENT_CALLED",
    "PATIENT_DONE",
    "PATIENT_LATE",
    "PATIENT_NO_SHOW",
    "PATIENT_REINSERTED",
    "PATIENT_ARRIVED",
    "WALKIN_ADDED",
    "BOOKING_CANCELLED",
    "PRIORITY_REORDERED",
)

#: The ones a waiting patient is told about even with the app closed (FR-QUE-42).
MATERIAL_EVENT_TYPES: tuple[str, ...] = (
    "DOCTOR_ARRIVED",
    "DELAY_DECLARED",
    "PATIENT_CALLED",
    "PATIENT_NO_SHOW",
    "SLOT_OFFERED",
    "BOOKING_CANCELLED",
    "SESSION_ENDED",
)


def booking_id_of(event: QueueEvent) -> str | None:
    """The booking an event is about, or None for session-wide events."""
    kind = event["type"]
    if kind in BOOKING_SCOPED_EVENT_TYPES:
        return event["payload"]["bookingId"]
    if kind == "SLOT_OFFERED":
        return event["payload"]["freedBookingId"]
    if kind == "SLOT_ACCEPTED":
        return event["payload"]["newBookingId"]
    return None


def is_material_event(kind: str) -> bool:
    return kind in MATERIAL_EVENT_TYPES
