"""Booking a serial, viewing it and cancelling it (port of `services/booking.service.ts`;
FR-PAT-20..28, FR-GST-01..08, FR-PAY-01, FR-QUE-52).

The chamber row is locked while the next serial is chosen, so two patients
booking at once never take the same number. The serial exists before the
payment does: a payment that fails never undoes a booking already made.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from ..adapters.payments import available_methods
from ..core import db
from ..core.env import env
from ..core.errors import AppError, not_found, validation_failed
from ..core.links import patient_link
from ..core.logging import logger
from ..core.schema import js_trim
from ..core.scope import as_queue
from ..core.serial_ticket import ticket_for, tickets_in
from ..domain.payments import prepayment_reason
from ..domain.queue.patient_view import patient_view_of
from ..domain.queue.standing import booking_standing
from ..domain.sessions import arrival_window_at
from ..domain.time import add_minutes, from_datetime, js_round, now_iso, now_ms, parse_ms, to_dhaka_date, utc_now
from ..repositories import booking as booking_repo
from ..repositories import guest as guest_repo
from ..repositories import patient_auth as patient_auth_repo
from ..repositories import payment as payment_repo
from ..repositories import session as session_repo
from . import modules
from . import notification as notifications
from . import payment as payments
from . import portal as portals
from . import queue as queue_service
from .links import mint_tracking_token


def fee_for(consultation_poisha: int, method: str) -> dict[str, int]:
    platform_fee_poisha = env().PLATFORM_FEE_POISHA
    total_poisha = consultation_poisha + platform_fee_poisha
    return {
        "consultationPoisha": consultation_poisha,
        "platformFeePoisha": platform_fee_poisha,
        "totalPoisha": total_poisha,
        "dueAtHospitalPoisha": total_poisha if method == "at_hospital" else 0,
    }


def _guard(message: str, guard: str) -> AppError:
    return AppError("QUEUE_GUARD_FAILED", message=message, details={"guard": guard})


def create_booking(
    *,
    session_id: str,
    booker: dict[str, Any],
    method: str,
    reason: str | None = None,
    intake: dict[str, Any] | None = None,
    arrival_window_start: str | None = None,
    client_event_id: str | None = None,
) -> dict[str, Any]:
    with as_queue():
        session = queue_service.require_session(session_id)
        modules.require_on(session["hospitalId"], "queue")
        if session["status"] in ("ended", "cancelled"):
            raise _guard("This chamber is no longer taking bookings.", "SESSION_CLOSED")
        if not session_repo.hospital_is_live(session_id):
            raise _guard("This hospital is not taking bookings here at the moment.", "HOSPITAL_NOT_LIVE")
        fee = fee_for(session["feePoisha"], method)
        with db.transaction():
            created = _book(
                session=session,
                session_id=session_id,
                booker=booker,
                method=method,
                reason=reason,
                intake=intake,
                arrival_window_start=arrival_window_start,
                key=client_event_id,
            )
        tracking_url = (
            issue_tracking_link(created["bookingId"], session_id, booker["phone"])
            if booker["kind"] == "guest"
            else _issue_account_link(booker["userId"], created["bookingId"], session_id)
        )
        if created["replayed"]:
            payment = _record_booking_payment(created, method, client_event_id)
            return {
                "bookingId": created["bookingId"],
                "serial": created["serial"],
                "sessionId": session_id,
                "fee": fee,
                "trackingUrl": tracking_url,
                "paid": payment is not None and payment["state"] == "paid",
                "payment": payment,
                "duplicate": True,
            }
        queue_service.broadcast_roster(session_id)
        payment = _record_booking_payment(created, method, client_event_id)
        held = payment is not None and payment["state"] == "pending" and payment["holdUntil"] is not None
        _queue_booking_confirmation(
            created["bookingId"],
            session_id,
            tracking_url,
            max(1, js_round((parse_ms(payment["holdUntil"]) - now_ms()) / 60_000)) if held and payment else None,
        )
        return {
            "bookingId": created["bookingId"],
            "serial": created["serial"],
            "sessionId": session_id,
            "fee": fee,
            "trackingUrl": tracking_url,
            "paid": payment is not None and payment["state"] == "paid",
            "payment": payment,
            "duplicate": False,
        }


def _book(
    *,
    session: dict[str, Any],
    session_id: str,
    booker: dict[str, Any],
    method: str,
    reason: str | None,
    intake: dict[str, Any] | None,
    arrival_window_start: str | None,
    key: str | None,
) -> dict[str, Any]:
    locked = session_repo.lock_for_update(session_id)
    if locked is None:
        raise not_found("session")
    patient_id = _resolve_patient(booker)
    if key is not None:
        made = booking_repo.find_by_idempotency_key(key)
        if made is not None:
            if made["sessionId"] != session_id or made["patientId"] != patient_id:
                raise AppError("IDEMPOTENCY_KEY_REUSED")
            return {
                "bookingId": made["id"],
                "serial": made["serial"],
                "patientId": patient_id,
                "payer": _payer_of(booker),
                "replayed": True,
            }
    duplicate = booking_repo.find_same_doctor_same_day(
        patient_id=patient_id, doctor_id=locked["doctorId"], session_date=locked["sessionDate"]
    )
    if duplicate is not None:
        raise AppError("BOOKING_DUPLICATE", details={"bookingId": duplicate["id"], "serial": duplicate["serial"]})
    roster = booking_repo.roster_for(session_id)
    live = len(roster)
    if locked["capacity"] is not None and live >= locked["capacity"]:
        raise AppError("SESSION_FULL", details={"capacity": locked["capacity"], "taken": live})
    serial = max((booking["serial"] for booking in roster), default=0) + 1
    booked_by_guest_id = _guest_id_for(booker) if booker["kind"] == "guest" else None
    if booked_by_guest_id is not None:
        since = utc_now() - timedelta(hours=24)
        made_count = booking_repo.count_guest_bookings_since(booked_by_guest_id, since)
        if made_count >= env().GUEST_BOOKINGS_PER_PHONE_PER_DAY:
            raise AppError(
                "BOOKING_LIMIT_REACHED",
                details={"limit": env().GUEST_BOOKINGS_PER_PHONE_PER_DAY, "windowHours": 24},
            )
    rules = payment_repo.prepayment_rules(locked["hospitalId"])
    no_shows = (
        booking_repo.count_no_shows_at(
            guest_id=booked_by_guest_id, hospital_id=locked["hospitalId"], since=_dhaka_days_ago(rules["windowDays"])
        )
        if booked_by_guest_id is not None and rules["noShowRuleOn"]
        else 0
    )
    prepayment = prepayment_reason(
        online_payment_taken=len(available_methods()) > 0,
        hospital_pays_first=rules["paysFirst"],
        guest=booked_by_guest_id is not None,
        no_show_rule_on=rules["noShowRuleOn"],
        no_shows=no_shows,
    )
    if prepayment is not None and method == "at_hospital":
        raise AppError("PREPAYMENT_REQUIRED", details={"reason": prepayment})
    window_start: str | None = None
    if arrival_window_start is not None:
        window = (
            arrival_window_at(
                from_datetime(locked["plannedStart"]), from_datetime(locked["plannedEnd"]), arrival_window_start
            )
            if booking_repo.offers_arrival_windows(locked["hospitalId"])
            else None
        )
        if window is None:
            raise AppError("ARRIVAL_WINDOW_NOT_OFFERED")
        window_start = window["start"]
    booking_id = booking_repo.insert_booking(
        session_id=session_id,
        patient_id=patient_id,
        serial=serial,
        source="guest_link" if booker["kind"] == "guest" else "app",
        fee_poisha=session["feePoisha"],
        booked_by_user_id=booker["userId"] if booker["kind"] == "user" else None,
        booked_by_guest_id=booked_by_guest_id,
        reason_text=reason,
        intake={**(intake or {}), **({"demo": True} if env().DEMO_MODE else {})},
        idempotency_key=key,
        prepayment_required=prepayment is not None,
        arrival_window_start=window_start,
    )
    payer = (
        {"kind": "user", "userId": booker["userId"]}
        if booker["kind"] == "user"
        else {"kind": "guest", "guestId": booked_by_guest_id or ""}
    )
    return {"bookingId": booking_id, "serial": serial, "patientId": patient_id, "payer": payer, "replayed": False}


def _dhaka_days_ago(days: int) -> str:
    return to_dhaka_date(add_minutes(now_iso(), -days * 24 * 60))


def _payer_of(booker: dict[str, Any]) -> dict[str, str]:
    if booker["kind"] == "user":
        return {"kind": "user", "userId": booker["userId"]}
    return {"kind": "guest", "guestId": _guest_id_for(booker)}


def _record_booking_payment(created: dict[str, Any], method: str, client_event_id: str | None) -> dict[str, Any] | None:
    try:
        result = payments.create_intent(
            booking_id=created["bookingId"],
            method=method,
            idempotency_key=client_event_id if client_event_id is not None else str(uuid.uuid4()),
            return_to=lambda payment_id: patient_link(
                "/pay/return", {"payment": payment_id, "booking": created["bookingId"]}
            ),
            payer=created["payer"],
        )
        detail = booking_repo.find_detail(created["bookingId"])
        return {
            "id": result["payment"]["id"],
            "method": result["payment"]["method"],
            "state": result["payment"]["state"],
            "redirectUrl": result["redirectUrl"],
            "holdUntil": result["payment"]["holdUntil"],
            "afterHold": "released" if detail is not None and detail["prepaymentRequired"] is True else "counter",
        }
    except Exception as cause:  # noqa: BLE001 — the serial stands without its payment record.
        logger.error({"bookingId": created["bookingId"], "err": cause}, "could not record the payment")
        return None


def _queue_booking_confirmation(
    booking_id: str, session_id: str, tracking_url: str | None, held_minutes: int | None = None
) -> None:
    try:
        with db.transaction():
            batch = notifications.queue_for(
                session_id, notifications.plan_booking_confirmed(booking_id, tracking_url, held_minutes)
            )
        notifications.dispatch(batch)
    except Exception as error:  # noqa: BLE001 — a lost confirmation never undoes the booking.
        logger.error({"err": error, "sessionId": session_id}, "booking confirmation could not be queued")


def _resolve_patient(booker: dict[str, Any]) -> str:
    if booker["kind"] == "user":
        if not booking_repo.patient_belongs_to(booker["patientId"], booker["userId"]):
            raise validation_failed({"field": "patientId", "reason": "not_yours"})
        return booker["patientId"]
    guest_id = _guest_id_for(booker)
    return guest_repo.find_or_create_patient(
        guest_id=guest_id,
        full_name=booker["name"],
        age_years=booker["ageYears"],
        sex=booker["sex"],
        phone=booker["phone"],
    )


def _guest_id_for(booker: dict[str, Any]) -> str:
    return guest_repo.find_or_create_identity(phone=booker["phone"], display_name=booker["name"])


def issue_tracking_link(booking_id: str, session_id: str, phone: str) -> str:
    minted = mint_tracking_token(booking_id=booking_id, session_id=session_id, phone=phone)
    return patient_link(
        "/s",
        {"b": booking_id, "t": minted["token"]},
        hospital_origin=portals.hospital_link_origin(minted["hospitalId"]),
    )


def _issue_account_link(user_id: str, booking_id: str, session_id: str) -> str:
    user = patient_auth_repo.user_by_id(user_id)
    if user is None:
        raise not_found("account")
    booking = booking_repo.find_detail(booking_id)
    if booking is None:
        raise not_found("booking")
    with db.transaction():
        guest_repo.find_or_create_identity(phone=user["phone"], display_name=booking["patientName"])
    return issue_tracking_link(booking_id, session_id, user["phone"])


def my_bookings(user_id: str) -> dict[str, Any]:
    rows = booking_repo.list_for_account(user_id)
    return {
        "bookings": [{**row, "standing": booking_standing(row["sessionStatus"], row["status"])} for row in rows],
        "serverTs": now_iso(),
    }


LINK_GRACE_MS = 24 * 3_600_000


def link_for_my_booking(user_id: str, booking_id: str) -> dict[str, str]:
    owned = booking_repo.owned_by_account(booking_id, user_id)
    if owned is None:
        raise not_found("booking")
    if owned["plannedEnd"].timestamp() * 1000 + LINK_GRACE_MS <= now_ms():
        raise AppError("GUEST_LINK_EXPIRED")
    return {"url": _issue_account_link(user_id, booking_id, owned["sessionId"])}


def booking_view(booking_id: str, audience: str) -> dict[str, Any]:
    booking = booking_repo.find_detail(booking_id)
    if booking is None:
        raise not_found("booking")
    state = queue_service.get_state(booking["sessionId"])
    etas = queue_service.get_etas(booking["sessionId"])
    cached = queue_service.get_cached_state(booking["sessionId"])
    paid = payments.for_booking(booking_id)
    settled = next(
        (entry for entry in paid if entry["paidAt"] is not None and entry["refundedPoisha"] < entry["amountPoisha"]),
        None,
    )
    if audience == "staff":
        seen: dict[str, Any] = {"state": state, "etas": etas, "ticket": booking["id"]}
    else:
        seen = {
            **patient_view_of(state, etas, tickets_in(booking["sessionId"])),
            "ticket": ticket_for(booking["sessionId"], booking["id"]),
        }
    return {
        "booking": booking,
        **seen,
        "payment": None
        if settled is None
        else {
            "amountPoisha": settled["amountPoisha"],
            "platformFeePoisha": settled["platformFeePoisha"],
            "refundedPoisha": settled["refundedPoisha"],
            "paidAt": settled["paidAt"],
        },
        "freshAt": from_datetime(cached["updatedAt"]) if cached is not None else now_iso(),
        "serverTs": now_iso(),
    }


CANCELLED_BY = {
    "patient": "রোগী অ্যাপে বাতিল করেছেন",
    "counter": "কাউন্টার থেকে বাতিল করা হয়েছে",
}


def cancel_booking(
    *,
    booking_id: str,
    actor: dict[str, Any],
    reason: str | None = None,
    client_event_id: str | None = None,
    client_ts: str | None = None,
) -> dict[str, Any]:
    booking = queue_service.require_booking(booking_id)
    replayed = queue_service.find_replay(client_event_id, booking["sessionId"])
    if replayed is not None:
        return replayed
    if booking["status"] == "cancelled":
        raise _guard("This booking is already cancelled.", "BOOKING_ALREADY_CANCELLED")
    if booking["status"] == "done":
        raise _guard("This visit has already happened.", "BOOKING_ALREADY_DONE")
    stated = js_trim(reason) if reason is not None else None
    return queue_service.append_event(
        {
            "sessionId": booking["sessionId"],
            "type": "BOOKING_CANCELLED",
            "payload": {
                "bookingId": booking["id"],
                "reason": stated
                if stated
                else (CANCELLED_BY["counter"] if actor["kind"] == "staff" else CANCELLED_BY["patient"]),
            },
            "actor": actor,
            "clientEventId": client_event_id,
            "clientTs": client_ts,
        }
    )
