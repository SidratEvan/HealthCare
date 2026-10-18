"""Whether a booking is still current (port of `queue/standing.ts`; FR-PAT-39, FR-QUE-06).

"A serial is current until it is settled, whatever the date." No date here,
and that is the rule.
"""

from __future__ import annotations

SESSION_OVER = ("ended", "cancelled")
BOOKING_SETTLED = ("done", "cancelled", "rescheduled")


def booking_standing(session: str, booking: str) -> str:
    if session in SESSION_OVER or booking in BOOKING_SETTLED:
        return "past"
    return "current"
