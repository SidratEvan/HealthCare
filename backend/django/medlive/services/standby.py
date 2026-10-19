"""The standby list, from the patient's side (port of `services/standby.service.ts`; FR-QUE-30..35, FR-PAT-35).

A full chamber takes names in order. When a serial frees, the first is
offered the chair for a few minutes; accepting seats them through the queue
(`SLOT_ACCEPTED`), declining or letting it lapse offers the next.
"""

from __future__ import annotations

import uuid
from typing import Any

from ..core import db
from ..core.errors import AppError, not_found
from ..core.jwt import verify_token
from ..core.links import patient_link
from ..core.logging import logger
from ..core.scope import as_queue
from ..domain.time import from_datetime, utc_now
from ..repositories import booking as booking_repo
from ..repositories import guest as guest_repo
from ..repositories import notification as notification_repo
from ..repositories import payment as payment_repo
from ..repositories import session as session_repo
from ..repositories import standby as standby_repo
from . import booking as bookings
from . import modules
from . import payment as payments
from . import queue as queue_service
from .links import standby_token, standby_url


def _guard_failed(guard: str, message: str) -> AppError:
    return AppError("QUEUE_GUARD_FAILED", message=message, details={"guard": guard})


def join(*, session_id: str, guest: dict[str, Any], prepay: str | None, client_event_id: str | None) -> dict[str, Any]:
    with as_queue():
        session = queue_service.require_session(session_id)
        modules.require_on(session["hospitalId"], "queue")
        if session["status"] in ("ended", "cancelled"):
            raise _guard_failed("SESSION_CLOSED", "This chamber is no longer taking anybody.")
        with db.transaction():
            joined = _join_locked(session_id, guest, client_event_id)
        row = standby_repo.find_standby(joined["standbyId"])
        if row is None:
            raise not_found("standby")
        prepaid = row["prepaid"]
        if not prepaid and prepay is not None and row["guestId"] is not None:
            try:
                result = payments.create_standby_prepayment(
                    standby_id=row["id"],
                    amount_poisha=session["feePoisha"],
                    method=prepay,
                    idempotency_key=client_event_id if client_event_id is not None else str(uuid.uuid4()),
                    return_url=patient_link("/standby"),
                    payer={"kind": "guest", "guestId": row["guestId"]},
                )
                prepaid = result["payment"]["state"] == "paid"
            except Exception as cause:  # noqa: BLE001 — a place on the list stands without its prepayment.
                logger.warn({"standbyId": row["id"], "err": cause}, "standby prepayment did not complete")
        token = standby_token(row["id"], row["guestId"] or row["patientId"])
        return {
            "standbyId": row["id"],
            "position": row["position"],
            "prepaid": prepaid,
            "token": token,
            "statusUrl": standby_url(token),
            "duplicate": joined["duplicate"],
        }


def _join_locked(session_id: str, guest: dict[str, Any], client_event_id: str | None) -> dict[str, Any]:
    locked = session_repo.lock_for_update(session_id)
    if locked is None:
        raise not_found("session")
    if client_event_id is not None:
        existing = standby_repo.find_by_idempotency_key(client_event_id)
        if existing is not None:
            return {"standbyId": existing, "duplicate": True}
    roster = booking_repo.roster_for(session_id)
    if locked["capacity"] is None or len(roster) < locked["capacity"]:
        raise _guard_failed("SESSION_NOT_FULL", "This chamber still has serials free — book one instead of waiting.")
    guest_id = guest_repo.find_or_create_identity(phone=guest["phone"], display_name=guest["name"])
    patient_id = guest_repo.find_or_create_patient(
        guest_id=guest_id, full_name=guest["name"], age_years=guest["ageYears"], sex=guest["sex"], phone=guest["phone"]
    )
    if any(booking["patientId"] == patient_id for booking in roster):
        raise _guard_failed("ALREADY_BOOKED", "This patient already has a serial in this chamber.")
    already = standby_repo.active_for(session_id, patient_id)
    if already is not None:
        return {"standbyId": already["id"], "duplicate": True}
    inserted = standby_repo.insert_standby(
        session_id=session_id,
        patient_id=patient_id,
        guest_id=guest_id,
        contact_phone=guest["phone"],
        idempotency_key=client_event_id,
    )
    return {"standbyId": inserted["id"], "duplicate": False}


def status(token: str) -> dict[str, Any]:
    with as_queue():
        standby_id = _standby_id_from(token)
        row = _require_row(standby_id)
        if row["removedAt"] is None:
            queue_service.expire_lapsed_offers(row["sessionId"], {"kind": "system", "job": "standby_status"})
            row = _require_row(standby_id)
        chamber = notification_repo.chamber_for(row["sessionId"])
        session = queue_service.require_session(row["sessionId"])
        now = utc_now()
        offer = standby_repo.open_offer_for(row["sessionId"], row["patientId"], now) if row["removedAt"] is None else None
        seated: dict[str, Any] | None = None
        if row["seatedBookingId"] is not None:
            booking = booking_repo.find_by_id(row["seatedBookingId"])
            if booking is not None:
                issued = guest_repo.has_tracking_link(booking["id"])
                seated = {
                    "bookingId": booking["id"],
                    "serial": booking["serial"],
                    "trackingUrl": None
                    if issued
                    else bookings.issue_tracking_link(booking["id"], row["sessionId"], row["contactPhone"]),
                }
        if seated is not None:
            state = "seated"
        elif row["removedAt"] is not None:
            state = "left"
        elif offer is not None:
            state = "offered"
        else:
            state = "waiting"
        return {
            "standbyId": row["id"],
            "sessionId": row["sessionId"],
            "state": state,
            "doctorNameBn": chamber["doctorNameBn"] if chamber else None,
            "doctorNameEn": chamber["doctorNameEn"] if chamber else None,
            "hospitalNameBn": chamber["hospitalNameBn"] if chamber else None,
            "hospitalNameEn": chamber["hospitalNameEn"] if chamber else None,
            "plannedStart": from_datetime(session["plannedStart"]),
            "feePoisha": session["feePoisha"],
            "position": row["position"],
            "ahead": standby_repo.ahead_of(row["sessionId"], row["position"]) if row["removedAt"] is None else 0,
            "prepaid": row["prepaid"],
            "offer": None if offer is None else {"id": offer["id"], "expiresAt": from_datetime(offer["expiresAt"])},
            "seated": seated,
            "serverTs": from_datetime(now),
        }


def accept(token: str, *, method: str, client_event_id: str | None) -> dict[str, Any]:
    with as_queue():
        standby_id = _standby_id_from(token)
        row = _require_row(standby_id)
        booking_id = row["seatedBookingId"]
        serial: int | None = None
        if booking_id is None:
            offer = standby_repo.open_offer_for(row["sessionId"], row["patientId"], utc_now())
            if offer is None:
                raise _guard_failed("NO_OPEN_OFFER", "There is no chair on offer to you right now.")
            seat = queue_service.accept_slot_detailed(
                offer_id=offer["id"],
                actor=lambda new_booking_id: {"kind": "guest", "bookingId": new_booking_id},
                client_event_id=client_event_id,
            )
            booking_id = seat["newBookingId"] or _require_row(standby_id)["seatedBookingId"]
            serial = seat["serial"]
        if booking_id is None:
            raise not_found("booking")
        booking = booking_repo.find_by_id(booking_id)
        if booking is None:
            raise not_found("booking")
        existing = payment_repo.list_for_booking(booking["id"])
        paid = any(payment["state"] == "paid" for payment in existing)
        if not existing and row["guestId"] is not None:
            try:
                result = payments.create_intent(
                    booking_id=booking["id"],
                    method=method,
                    idempotency_key=client_event_id if client_event_id is not None else str(uuid.uuid4()),
                    return_to=lambda payment_id: patient_link(
                        "/pay/return", {"payment": payment_id, "booking": booking["id"]}
                    ),
                    payer={"kind": "guest", "guestId": row["guestId"]},
                )
                paid = result["payment"]["state"] == "paid"
            except Exception as cause:  # noqa: BLE001 — the seat stands without its payment record.
                logger.error({"bookingId": booking["id"], "err": cause}, "could not record the payment")
        issued = guest_repo.has_tracking_link(booking["id"])
        return {
            "bookingId": booking["id"],
            "serial": serial if serial is not None else booking["serial"],
            "trackingUrl": None
            if issued
            else bookings.issue_tracking_link(booking["id"], row["sessionId"], row["contactPhone"]),
            "paid": paid,
        }


def decline(token: str) -> None:
    with as_queue():
        standby_id = _standby_id_from(token)
        row = _require_row(standby_id)
        offer = standby_repo.open_offer_for(row["sessionId"], row["patientId"], utc_now())
        if offer is None:
            raise _guard_failed("NO_OPEN_OFFER", "There is no chair on offer to you right now.")
        queue_service.decline_slot(offer_id=offer["id"], actor={"kind": "system", "job": "standby_declined"})


def leave(token: str) -> dict[str, bool]:
    with as_queue():
        standby_id = _standby_id_from(token)
        row = _require_row(standby_id)
        if row["removedAt"] is not None:
            return {"refundOwed": False}
        offer = standby_repo.open_offer_for(row["sessionId"], row["patientId"], utc_now())
        if offer is not None:
            queue_service.decline_slot(offer_id=offer["id"], actor={"kind": "system", "job": "standby_left"})
        with db.transaction():
            if not standby_repo.leave(standby_id, utc_now()):
                return {"refundOwed": False}
            payment_id = payment_repo.paid_for_standby(standby_id)
            if payment_id is None:
                return {"refundOwed": False}
            owed = payment_repo.mark_refund_owed(payment_ids=[payment_id], reason="standby_unseated")
            return {"refundOwed": owed > 0}


def _standby_id_from(token: str) -> str:
    verified = verify_token(token, "standby")
    if not verified.ok:
        reason = verified.reason  # type: ignore[union-attr]
        if reason == "expired":
            raise AppError("GUEST_LINK_EXPIRED")
        raise AppError("AUTH_TOKEN_INVALID", details={"reason": reason})
    standby_id = verified.claims.get("standbyId")  # type: ignore[union-attr]
    if standby_id is None:
        raise AppError("AUTH_TOKEN_INVALID", details={"reason": "no_standby"})
    return standby_id


def _require_row(standby_id: str) -> dict[str, Any]:
    row = standby_repo.find_standby(standby_id)
    if row is None:
        raise not_found("standby")
    return row

