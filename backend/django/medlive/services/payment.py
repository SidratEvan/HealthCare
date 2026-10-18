"""Money (port of `services/payment.service.ts`; FR-PAY-01..10, FR-SUP-04).

A payment is created once per idempotency key, charged through the
provider for its method, and confirmed by asking the provider rather than
by trusting a return URL. A hold that lapses either moves the serial to the
counter or, where the hospital takes payment first, releases it.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from ..adapters.payments import is_online, mock_provider, payments as callback_provider, provider_for
from ..core import db
from ..core.env import env
from ..core.errors import AppError, forbidden_scope, not_found
from ..core.logging import logger
from ..core.scope import SYSTEM, db_scope
from ..domain.payments import read_refund_policy, refund_for, settle
from ..domain.time import now_iso, now_ms, parse_ms, utc_now
from ..repositories import booking as booking_repo
from ..repositories import notification as notification_repo
from ..repositories import payment as payment_repo

PAID_STATES = frozenset({"paid", "partially_refunded", "refunded"})

ReturnTo = Callable[[str], str]


def _at(iso_text: str) -> datetime:
    return datetime.fromtimestamp(parse_ms(iso_text) / 1000, tz=timezone.utc)


def _payer_columns(payer: dict[str, str]) -> dict[str, str | None]:
    return {
        "payer_user_id": payer["userId"] if payer["kind"] == "user" else None,
        "payer_guest_id": payer["guestId"] if payer["kind"] == "guest" else None,
    }


def platform_fee_within(amount_poisha: int) -> int:
    return min(env().PLATFORM_FEE_POISHA, amount_poisha)


def create_intent(
    *, booking_id: str, method: str, idempotency_key: str, return_to: ReturnTo, payer: dict[str, str]
) -> dict[str, Any]:
    online = is_online(method)
    if online and provider_for(method) is None:
        raise AppError("PAYMENT_UNAVAILABLE", details={"method": method})
    with db.transaction():
        payment_repo.lock_idempotency_key(idempotency_key)
        replayed = payment_repo.find_by_idempotency_key(idempotency_key)
        if replayed is not None:
            payment, duplicate = replayed, True
        else:
            booking = booking_repo.find_detail(booking_id)
            if booking is None:
                raise not_found("booking")
            earlier = payment_repo.lock_for_booking(booking_id)
            if any(row["state"] in PAID_STATES for row in earlier):
                raise AppError("PAYMENT_ALREADY_MADE")
            if not online and booking["prepaymentRequired"]:
                raise AppError("PREPAYMENT_REQUIRED")
            deadlines = sorted(row["holdUntil"] for row in earlier if row["holdUntil"] is not None)
            first_deadline = deadlines[0] if deadlines else None
            if online and first_deadline is not None and parse_ms(first_deadline) <= now_ms():
                raise AppError("PAYMENT_HOLD_ENDED")
            if not online:
                hold_until = None
            elif first_deadline is not None:
                hold_until = _at(first_deadline)
            else:
                hold_until = utc_now() + timedelta(minutes=booking["paymentHoldMinutes"])
            payment_id = payment_repo.insert_payment(
                booking_id=booking_id,
                bed_request_id=None,
                test_order_id=None,
                ambulance_request_id=None,
                **_payer_columns(payer),
                amount_poisha=booking["feePoisha"],
                platform_fee_poisha=platform_fee_within(booking["feePoisha"]),
                method=method,
                idempotency_key=idempotency_key,
                created_by=None,
                hold_until=hold_until,
            )
            payment_repo.record_event(payment_id=payment_id, kind="created", detail={"method": method})
            if not online:
                for row in earlier:
                    if row["state"] == "pending" and is_online(row["method"]):
                        payment_repo.mark_failed(row["id"], "superseded")
                        payment_repo.record_event(payment_id=row["id"], kind="superseded")
            created = payment_repo.find_payment(payment_id)
            if created is None:
                raise not_found("payment")
            payment, duplicate = created, False
    return _charge(payment, duplicate, return_to(payment["id"]))


def create_standby_prepayment(
    *, standby_id: str, amount_poisha: int, method: str, idempotency_key: str, return_url: str, payer: dict[str, str]
) -> dict[str, Any]:
    if is_online(method) and provider_for(method) is None:
        raise AppError("PAYMENT_UNAVAILABLE", details={"method": method})
    with db.transaction():
        payment_repo.lock_idempotency_key(idempotency_key)
        replayed = payment_repo.find_by_idempotency_key(idempotency_key)
        if replayed is not None:
            payment, duplicate = replayed, True
        else:
            payment_id = payment_repo.insert_payment(
                booking_id=None,
                bed_request_id=None,
                test_order_id=None,
                ambulance_request_id=None,
                standby_id=standby_id,
                **_payer_columns(payer),
                amount_poisha=amount_poisha,
                platform_fee_poisha=platform_fee_within(amount_poisha),
                method=method,
                idempotency_key=idempotency_key,
                created_by=None,
            )
            payment_repo.record_event(payment_id=payment_id, kind="created", detail={"method": method})
            created = payment_repo.find_payment(payment_id)
            if created is None:
                raise not_found("payment")
            payment, duplicate = created, False
    return _charge(payment, duplicate, return_url)


def _charge(payment: dict[str, Any], duplicate: bool, return_url: str) -> dict[str, Any]:
    server_ts = now_iso()
    if duplicate:
        return {"payment": payment, "redirectUrl": None, "duplicate": True, "serverTs": server_ts}
    provider = provider_for(payment["method"])
    if provider is None:
        return {"payment": payment, "redirectUrl": None, "duplicate": False, "serverTs": server_ts}
    charged = provider.charge(
        payment_id=payment["id"],
        amount_poisha=payment["amountPoisha"],
        idempotency_key=payment["id"],
        return_url=return_url,
    )
    if not charged["ok"]:
        with db.transaction():
            payment_repo.mark_failed(payment["id"], "provider_error")
            payment_repo.record_event(
                payment_id=payment["id"],
                kind="failed",
                detail={"reason": "provider_error", "provider": provider.name},
            )
        raise AppError("PAYMENT_FAILED", details={"reason": charged["error"]})
    with db.transaction():
        payment_repo.set_checkout(payment["id"], charged["checkoutId"])
        if charged["settled"]:
            provider_ref = charged.get("providerRef")
            payment_repo.mark_paid(
                payment_id=payment["id"],
                provider_ref=provider_ref if provider_ref is not None else charged["checkoutId"],
                at=utc_now(),
            )
            payment_repo.record_event(payment_id=payment["id"], kind="paid")
        else:
            payment_repo.record_event(payment_id=payment["id"], kind="redirected", detail={"provider": provider.name})
        after = payment_repo.find_payment(payment["id"])
    return {
        "payment": after if after is not None else payment,
        "redirectUrl": None if charged["settled"] else charged.get("redirectUrl"),
        "duplicate": False,
        "serverTs": server_ts,
    }


def confirm_for_booking(*, booking_id: str, payment_id: str, hint: str | None) -> dict[str, Any]:
    with db_scope(SYSTEM):
        payment = payment_repo.find_payment(payment_id)
        if payment is None or payment["bookingId"] != booking_id:
            raise not_found("payment")
        _ask(payment, hint)
        with db.transaction():
            after = payment_repo.find_payment(payment_id)
            if after is None:
                raise not_found("payment")
            booking = booking_repo.find_detail(booking_id)
            return {
                "payment": after,
                "serial": _standing_of(booking_id),
                "counterAllowed": booking is not None and not booking["prepaymentRequired"],
                "serverTs": now_iso(),
            }


def _standing_of(booking_id: str) -> str:
    booking = booking_repo.find_detail(booking_id)
    rows = payment_repo.lock_for_booking(booking_id)
    if booking is None:
        return "cancelled"
    if booking["status"] == "cancelled":
        return "released" if any(row["failureReason"] == "expired" for row in rows) else "cancelled"
    if any(row["state"] in PAID_STATES for row in rows):
        return "confirmed"
    if any(row["state"] == "pending" and not is_online(row["method"]) for row in rows):
        return "counter"
    return "held"


def _ask(payment: dict[str, Any], hint: str | None) -> None:
    if payment["state"] in PAID_STATES:
        return
    if payment["failureReason"] in ("amount_mismatch", "provider_error"):
        return
    provider = provider_for(payment["method"])
    if provider is None:
        return
    with db.transaction():
        refs = payment_repo.refs_of(payment["id"])
    if refs["checkoutId"] is None:
        return
    answer = provider.confirm(
        payment_id=payment["id"], checkout_id=refs["checkoutId"], amount_poisha=payment["amountPoisha"], hint=hint
    )
    with db.transaction():
        tell = _apply_answer(payment["id"], answer, provider.name)
    _tell_patient(tell)


def _apply_answer(payment_id: str, answer: dict[str, Any], provider_name: str) -> dict[str, Any] | None:
    locked = payment_repo.lock_payment(payment_id)
    if locked is None:
        return None
    payment_repo.mark_checked(payment_id, utc_now())
    status = answer["status"]
    if status == "paid":
        return _settle_paid(locked, answer, provider_name)
    if status == "failed":
        if locked["state"] == "pending":
            payment_repo.mark_failed(payment_id, answer["reason"])
            payment_repo.record_event(
                payment_id=payment_id, kind="failed", detail={"reason": answer["reason"], "provider": provider_name}
            )
        return None
    # 'pending' and 'unreachable': nothing changes but the record of having asked.
    payment_repo.record_event(payment_id=payment_id, kind="asked", detail={"answer": status, "provider": provider_name})
    return None


def _settle_paid(locked: dict[str, Any], answer: dict[str, Any], provider_name: str) -> dict[str, Any] | None:
    if locked["state"] in PAID_STATES:
        return None
    if answer["amountPoisha"] != locked["amountPoisha"]:
        if locked["state"] == "pending":
            payment_repo.mark_failed(locked["id"], "amount_mismatch")
        payment_repo.record_event(payment_id=locked["id"], kind="amount_mismatch", detail={"provider": provider_name})
        logger.error({"paymentId": locked["id"]}, "provider reported a different amount")
        return None
    payment_repo.mark_paid(payment_id=locked["id"], provider_ref=answer["providerRef"], at=utc_now())
    payment_repo.record_event(payment_id=locked["id"], kind="paid", detail={"provider": provider_name})
    if locked["bookingId"] is None:
        return None
    booking = booking_repo.find_detail(locked["bookingId"])
    if booking is None:
        return None
    siblings = payment_repo.lock_for_booking(locked["bookingId"])
    already_paid = any(row["id"] != locked["id"] and row["state"] in PAID_STATES for row in siblings)
    if already_paid or booking["status"] == "cancelled":
        reason = "duplicate_payment" if already_paid else "paid_after_release"
        payment_repo.mark_refund_owed(payment_ids=[locked["id"]], reason=reason)
        payment_repo.record_event(payment_id=locked["id"], kind="owed_back", detail={"reason": reason})
        return {
            "bookingId": booking["id"],
            "sessionId": booking["sessionId"],
            "templateKey": "payment.owed_back",
            "withLink": False,
        }
    for row in siblings:
        if row["id"] != locked["id"] and row["state"] == "pending":
            payment_repo.mark_failed(row["id"], "superseded")
            payment_repo.record_event(payment_id=row["id"], kind="superseded")
    return {
        "bookingId": booking["id"],
        "sessionId": booking["sessionId"],
        "templateKey": "booking.confirmed",
        "withLink": True,
    }


def _tell_patient(telling: dict[str, Any] | None) -> None:
    if telling is None:
        return
    from . import notification as notifications
    from .links import reissue_link

    try:
        with db_scope(SYSTEM):
            link: str | None = None
            if telling["withLink"]:
                with db.transaction():
                    recipient = next(
                        (
                            entry
                            for entry in notification_repo.recipients_for_session(telling["sessionId"])
                            if entry["bookingId"] == telling["bookingId"]
                        ),
                        None,
                    )
                link = reissue_link(
                    {"linkKind": "booking", "bookingId": telling["bookingId"]},
                    recipient["phone"] if recipient is not None else None,
                )
            params: dict[str, str] = dict(telling.get("params") or {})
            if link is not None:
                params.update({"link": link, "linkKind": "booking"})
            with db.transaction():
                batch = notifications.queue_for(
                    telling["sessionId"],
                    [{"bookingId": telling["bookingId"], "templateKey": telling["templateKey"], "params": params}],
                )
            notifications.dispatch(batch)
    except Exception as cause:  # noqa: BLE001 — a message lost here must not undo the payment.
        logger.error({"bookingId": telling["bookingId"], "err": cause}, "payment message not queued")


def expire_holds(now: datetime | None = None) -> int:
    now = now or utc_now()
    with db_scope(SYSTEM):
        due = payment_repo.bookings_with_holds_due(now, 50)
        for booking_id in due:
            try:
                _expire_one(booking_id, now)
            except Exception as cause:  # noqa: BLE001 — one stuck hold must not stop the others.
                logger.error({"bookingId": booking_id, "err": cause}, "payment hold could not be closed")
        return len(due)


def _expire_one(booking_id: str, now: datetime) -> None:
    now_epoch = now.timestamp() * 1000
    pending = [
        row for row in payment_repo.list_for_booking(booking_id) if row["state"] == "pending" and is_online(row["method"])
    ]
    for row in pending:
        _ask(row, None)
    outcome: dict[str, Any] | None = None
    with db.transaction():
        booking = booking_repo.find_detail(booking_id)
        rows = payment_repo.lock_for_booking(booking_id)
        if booking is not None:
            for row in rows:
                if row["holdUntil"] is None or parse_ms(row["holdUntil"]) >= now_epoch:
                    continue
                if row["state"] == "pending":
                    payment_repo.mark_failed(row["id"], "expired")
                payment_repo.record_event(payment_id=row["id"], kind="expired")
            # Judged on the rows as locked, as in Node: a hold just marked failed
            # still reads pending here, but its deadline has passed, so it is not live.
            paid = any(row["state"] in PAID_STATES for row in rows)
            counter = any(row["state"] == "pending" and not is_online(row["method"]) for row in rows)
            live = any(
                row["state"] == "pending" and row["holdUntil"] is not None and parse_ms(row["holdUntil"]) >= now_epoch
                for row in rows
            )
            standing = booking["status"] in ("booked", "waiting", "late")
            latest = rows[-1] if rows else None
            if not (paid or counter or live or not standing) and latest is not None:
                if booking["prepaymentRequired"]:
                    payment_repo.record_event(payment_id=latest["id"], kind="released")
                    outcome = {"kind": "release", "booking": booking}
                else:
                    payer = payment_repo.payer_of(latest["id"])
                    counter_id = payment_repo.insert_payment(
                        booking_id=booking_id,
                        bed_request_id=None,
                        test_order_id=None,
                        ambulance_request_id=None,
                        payer_user_id=payer["payerUserId"],
                        payer_guest_id=payer["payerGuestId"],
                        amount_poisha=booking["feePoisha"],
                        platform_fee_poisha=platform_fee_within(booking["feePoisha"]),
                        method="at_hospital",
                        idempotency_key=f"counter:{latest['id']}",
                        created_by=None,
                    )
                    payment_repo.record_event(payment_id=latest["id"], kind="counter")
                    payment_repo.record_event(
                        payment_id=counter_id, kind="created", detail={"method": "at_hospital", "after": "expired"}
                    )
                    outcome = {"kind": "counter", "booking": booking}
    if outcome is None:
        return
    if outcome["kind"] == "counter":
        _tell_patient(
            {
                "bookingId": booking_id,
                "sessionId": outcome["booking"]["sessionId"],
                "templateKey": "payment.counter",
                "withLink": True,
            }
        )
        return
    from . import notification as notifications
    from .booking import cancel_booking

    cancel_booking(
        booking_id=booking_id,
        actor={"kind": "system", "job": "payment_holds"},
        reason=notifications.PAYMENT_RELEASED_REASON,
        client_event_id=key_for(f"payment-release:{booking_id}"),
    )


def key_for(name: str) -> str:
    """A uuid-shaped key derived from a name, so a retried job repeats the same event."""
    hex_ = hashlib.sha256(name.encode("utf8")).hexdigest()
    return f"{hex_[0:8]}-{hex_[8:12]}-4{hex_[13:16]}-8{hex_[17:20]}-{hex_[20:32]}"


def ask_again_after_expiry(now: datetime | None = None) -> int:
    now = now or utc_now()
    with db_scope(SYSTEM):
        ids = payment_repo.expired_to_ask_again(now, 20)
        for payment_id in ids:
            row = payment_repo.find_payment(payment_id)
            if row is not None:
                try:
                    _ask(row, None)
                except Exception:  # noqa: BLE001 — `.catch(() => undefined)`: the next run asks again.
                    pass
        return len(ids)


def refund(*, payment_id: str, reason: str, note: str | None, idempotency_key: str, hospital_id: str) -> dict[str, Any]:
    with db.transaction():
        payment = payment_repo.lock_payment(payment_id)
        if payment is None or payment["bookingId"] is None:
            raise not_found("payment")
        booking = booking_repo.find_detail(payment["bookingId"])
        if booking is None:
            raise not_found("booking")
        if booking["hospitalId"] != hospital_id:
            raise forbidden_scope({"resource": "payment", "hospitalId": booking["hospitalId"]})
        decision: dict[str, Any] | None = None
        refs: dict[str, Any] = {}
        if payment["state"] != "refunded":
            decision = refund_for(
                {
                    "amountPoisha": payment["amountPoisha"],
                    "platformFeePoisha": payment["platformFeePoisha"],
                    "refundedPoisha": payment["refundedPoisha"],
                    "paidAt": payment["paidAt"],
                },
                reason=reason,
                now=now_iso(),
                session_start=booking["plannedStart"],
                policy=read_refund_policy(booking["refundPolicy"]),
            )
            refs = payment_repo.refs_of(payment["id"])
    server_ts = now_iso()
    if decision is None:
        return {"payment": payment, "refundPoisha": 0, "duplicate": True, "byHand": False, "serverTs": server_ts}
    if not decision["stated"]:
        raise AppError("REFUND_POLICY_UNKNOWN")
    if decision["refundPoisha"] <= 0:
        return {"payment": payment, "refundPoisha": 0, "duplicate": False, "byHand": False, "serverTs": server_ts}
    provider = provider_for(payment["method"])
    by_hand = not (provider is not None and provider.refunds_by_api)
    if by_hand and (note is None or note.strip() == ""):
        raise AppError("REFUND_NOTE_REQUIRED")
    if provider is not None and not by_hand:
        returned = provider.refund(
            payment_id=payment["id"],
            checkout_id=refs.get("checkoutId"),
            provider_ref=refs.get("providerRef"),
            amount_poisha=decision["refundPoisha"],
            idempotency_key=idempotency_key,
            reason=decision["reason"],
        )
        if not returned["ok"]:
            logger.error({"paymentId": payment["id"], "err": returned.get("error")}, "refund failed")
            raise AppError("PAYMENT_FAILED", details={"reason": returned.get("error")})
    with db.transaction():
        payment_repo.record_refund(
            payment_id=payment["id"],
            amount_poisha=decision["refundPoisha"],
            reason=decision["reason"] if note is None else f"{decision['reason']}: {note}",
            at=utc_now(),
        )
        payment_repo.record_event(
            payment_id=payment["id"],
            kind="refunded",
            detail={"reason": decision["reason"], "by": "hand" if by_hand else "provider"},
        )
        after = payment_repo.find_payment(payment["id"])
    return {
        "payment": after if after is not None else payment,
        "refundPoisha": decision["refundPoisha"],
        "duplicate": False,
        "byHand": by_hand,
        "serverTs": server_ts,
    }


def raise_refunds_for_ended_session(session_id: str) -> dict[str, Any]:
    """`FR-PAY-07`: everybody who paid and was never seen is owed, without asking."""
    with db.transaction():
        standby_owed = payment_repo.mark_refund_owed(
            payment_ids=payment_repo.unseated_standby_for_session(session_id), reason="standby_unseated"
        )
        if standby_owed > 0:
            logger.info({"sessionId": session_id, "standbyOwed": standby_owed}, "standby refunds owed")
        owed = payment_repo.paid_for_session(session_id)
        if not owed:
            return {"eligible": 0, "reason": None}
        reason = "session_ended" if payment_repo.doctor_arrived(session_id) else "doctor_absent"
        eligible = payment_repo.mark_refund_owed(payment_ids=[o["paymentId"] for o in owed], reason=reason)
        logger.info({"sessionId": session_id, "eligible": eligible, "reason": reason}, "refund eligibility raised")
        return {"eligible": eligible, "reason": reason}


def for_booking(booking_id: str) -> list[dict[str, Any]]:
    return payment_repo.list_for_booking(booking_id)


def history(payment_id: str, *, hospital_id: str) -> dict[str, Any]:
    owner = payment_repo.hospital_of(payment_id)
    if owner is None or owner != hospital_id:
        raise not_found("payment")
    return {"events": payment_repo.history_of(payment_id)}


def settlement(*, hospital_id: str, date_from: str, date_to: str, actor_hospital_id: str) -> dict[str, Any]:
    if hospital_id != actor_hospital_id:
        raise forbidden_scope({"resource": "settlement", "hospitalId": hospital_id})
    rows = payment_repo.settlement_rows(hospital_id=hospital_id, date_from=date_from, date_to=date_to)
    bookings = payment_repo.bookings_in_period(hospital_id=hospital_id, date_from=date_from, date_to=date_to)
    return {"settlement": settle(rows), "bookings": bookings, "serverTs": now_iso()}


def verify_provider_signature(raw_body: str, signature: str | None) -> bool:
    return bool(callback_provider().verify_webhook(raw_body, signature))


def apply_provider_callback(*, provider_ref: str, paid: bool) -> dict[str, bool]:
    with db_scope(SYSTEM), db.transaction():
        payment = payment_repo.find_by_provider_ref(provider_ref)
        if payment is None or payment["state"] != "pending":
            return {"applied": False}
        if paid:
            payment_repo.mark_paid(payment_id=payment["id"], provider_ref=provider_ref, at=utc_now())
            payment_repo.record_event(payment_id=payment["id"], kind="paid")
        else:
            payment_repo.mark_failed(payment["id"], "declined")
            payment_repo.record_event(payment_id=payment["id"], kind="failed", detail={"reason": "declined"})
        logger.info({"paymentId": payment["id"], "paid": paid}, "provider callback applied")
        return {"applied": True}


def mock_attempt(checkout_id: str) -> dict[str, Any] | None:
    return mock_provider().attempt(checkout_id)


def mock_settle(checkout_id: str, outcome: str) -> str | None:
    return mock_provider().settle(checkout_id, outcome)
