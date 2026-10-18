"""Opening a tracking link (port of `services/guest.service.ts`; FR-GST-05, FR-GST-06, FR-LAB-04).

A link is a long random token, stored only as its hash, that opens one
booking. Opening it answers the booking's live view and a fifteen-minute
access token scoped to that booking alone.
"""

from __future__ import annotations

import hashlib
from typing import Any, Callable, TypeVar

from ..core.errors import AppError, not_found
from ..core.jwt import sign_token
from ..core.scope import SYSTEM, GuestScope, db_scope
from ..repositories import clinical as clinical_repo
from ..repositories import guest as guest_repo
from . import booking as booking_service

T = TypeVar("T")

TOKEN_TTL_SECONDS = 15 * 60


def report_url(token: str, report_id: str) -> str:
    from . import lab

    link = _resolve(token)
    if link is None:
        raise AppError("GUEST_LINK_EXPIRED")

    def body() -> str:
        orders = lab.orders_for_booking(link["bookingId"])
        owned = any((order.get("report") or {}).get("id") == report_id for order in orders)
        if not owned:
            raise not_found("report")
        url = lab.report_url(report_id)
        if url is None:
            raise not_found("report")
        return url

    return _as_link(link, body)


def _resolve(token: str) -> dict[str, Any] | None:
    token_hash = hashlib.sha256(token.encode("utf8")).hexdigest()
    with db_scope(SYSTEM):
        return guest_repo.resolve_tracking_token(token_hash)


def _as_link(link: dict[str, Any], body: Callable[[], T]) -> T:
    with db_scope(GuestScope(guest_id=link["guestId"], booking_id=link["bookingId"])):
        return body()


def open_tracking_link(token: str) -> dict[str, Any]:
    from . import lab

    link = _resolve(token)
    if link is None:
        raise AppError("GUEST_LINK_EXPIRED")

    def body() -> dict[str, Any]:
        view = booking_service.booking_view(link["bookingId"], "patient")
        return {
            **view,
            "record": clinical_repo.find_visit_for_booking(link["bookingId"]),
            "tests": lab.orders_for_booking(link["bookingId"]),
            "token": sign_token(
                "access", {"sub": link["guestId"], "kind": "guest", "bookingId": link["bookingId"]}
            ),
            "expiresInSeconds": TOKEN_TTL_SECONDS,
        }

    return _as_link(link, body)
