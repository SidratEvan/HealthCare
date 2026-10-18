"""A booking's ticket in the patients' copy of a queue (port of `config/serialTicket.ts`).

An HMAC of the chamber and the booking under the guest-link secret, shaped as
a UUID: the same booking has the same ticket in every broadcast, it cannot be
turned back into the booking, and it differs in another chamber. Identical to
the Node API's, so a phone keeps its ticket across the two.
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Callable

from .env import env

LABEL = "serial-ticket"


def ticket_for(session_id: str, booking_id: str) -> str:
    digest = hmac.new(
        env().GUEST_LINK_SECRET.encode("utf8"),
        f"{LABEL}\0{session_id}\0{booking_id}".encode("utf8"),
        hashlib.sha256,
    ).hexdigest()
    return "-".join((digest[0:8], digest[8:12], digest[12:16], digest[16:20], digest[20:32]))


def tickets_in(session_id: str) -> Callable[[str], str]:
    return lambda booking_id: ticket_for(session_id, booking_id)
