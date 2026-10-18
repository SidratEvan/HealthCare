"""Payment controllers (port of `controllers/payment.controller.ts`; FR-PAY-01..10, FR-SUP-04)."""

from __future__ import annotations

from ..core.errors import forbidden_scope, not_found, validation_failed
from ..core.http import ApiRequest, Reply, ok
from ..core.links import patient_link
from ..services import payment as payments
from .queue import assert_booking_scope, assert_booking_scope_for


def intent(req: ApiRequest) -> Reply:
    body = req.body
    booking_id = body.get("bookingId")
    if booking_id is None:
        raise validation_failed({"field": "bookingId", "reason": "only a booking can be paid for in this version"})
    principal = req.principal
    if principal is not None and principal.kind == "guest" and principal.booking_id != booking_id:
        raise forbidden_scope({"reason": "link_is_for_a_different_booking"})
    assert_booking_scope_for(req, booking_id)
    result = payments.create_intent(
        booking_id=booking_id,
        method=body["method"],
        idempotency_key=body["idempotencyKey"],
        return_to=lambda payment_id: patient_link("/pay/return", {"payment": payment_id, "booking": booking_id}),
        payer=_payer_of(req),
    )
    return ok(result, status=200 if result["duplicate"] else 201)


def confirm(req: ApiRequest) -> Reply:
    assert_booking_scope(req)
    # Already parsed by the route's `validate` (the Node controller parses it again).
    body = req.body if isinstance(req.body, dict) else {}
    payment_id = req.params.get("paymentId")
    if not isinstance(payment_id, str) or payment_id == "":
        raise not_found("route parameter")
    return ok(payments.confirm_for_booking(booking_id=_param(req), payment_id=payment_id, hint=body.get("hint")))


def history(req: ApiRequest) -> Reply:
    principal = _staff(req)
    return ok(payments.history(_param(req), hospital_id=principal.hospital_id or ""))


def refund(req: ApiRequest) -> Reply:
    body = req.body
    principal = _staff(req)
    return ok(
        payments.refund(
            payment_id=_param(req),
            reason=body["reason"],
            note=body["note"],
            idempotency_key=body["idempotencyKey"],
            hospital_id=principal.hospital_id or "",
        )
    )


def for_booking(req: ApiRequest) -> Reply:
    assert_booking_scope(req)
    return ok({"payments": payments.for_booking(_param(req))})


def settlement(req: ApiRequest) -> Reply:
    query = req.query
    principal = _staff(req)
    hospital_id = req.params.get("hospitalId")
    if not isinstance(hospital_id, str) or hospital_id == "":
        raise not_found("route parameter")
    return ok(
        payments.settlement(
            hospital_id=hospital_id,
            date_from=query["from"],
            date_to=query["to"],
            actor_hospital_id=principal.hospital_id or "",
        )
    )


def _staff(req: ApiRequest):  # type: ignore[no-untyped-def]
    principal = req.principal
    if principal is None or principal.kind != "staff":
        raise forbidden_scope({"reason": "staff_only"})
    return principal


def _param(req: ApiRequest) -> str:
    value = req.params.get("id")
    if not isinstance(value, str) or value == "":
        raise not_found("route parameter")
    return value


def _payer_of(req: ApiRequest) -> dict[str, str]:
    principal = req.principal
    if principal is not None and principal.kind == "guest":
        return {"kind": "guest", "guestId": principal.id}
    if principal is not None and principal.kind == "patient":
        return {"kind": "user", "userId": principal.id}
    raise forbidden_scope({"reason": "patient_or_guest_only"})
