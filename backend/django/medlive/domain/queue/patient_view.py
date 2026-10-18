"""What a patient's phone is sent of a chamber (port of `queue/patientView.ts`; plan I2c).

The same queue with nothing in it that names a person or a booking: each
booking id is a ticket the caller derives with a key only the server holds,
patient ids are the nil id, offers are to nobody, and what reception typed is
not sent.
"""

from __future__ import annotations

from typing import Any, Callable

NO_PATIENT = "00000000-0000-0000-0000-000000000000"


def patient_view_of(
    state: dict[str, Any], etas: list[dict[str, Any]], ticket_of: Callable[[str], str]
) -> dict[str, Any]:
    return {
        "state": {
            **state,
            "entries": [
                {
                    **entry,
                    "bookingId": ticket_of(entry["bookingId"]),
                    "patientId": NO_PATIENT,
                    "cancelled": None if entry["cancelled"] is None else {**entry["cancelled"], "reason": None},
                    "priority": None if entry["priority"] is None else {**entry["priority"], "reason": ""},
                }
                for entry in state["entries"]
            ],
            "offers": [
                {
                    **offer,
                    "freedBookingId": ticket_of(offer["freedBookingId"]),
                    "offeredTo": [],
                    "acceptedBookingId": None
                    if offer["acceptedBookingId"] is None
                    else ticket_of(offer["acceptedBookingId"]),
                }
                for offer in state["offers"]
            ],
            "undoneEventIds": [],
            "anomalies": [],
        },
        "etas": [{**eta, "bookingId": ticket_of(eta["bookingId"])} for eta in etas],
    }
