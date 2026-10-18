"""Payments, their history, and what a settlement is made of
(port of `repositories/payment.repo.ts`; FR-PAY-*)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from ..core import db
from ..domain.time import from_datetime, utc_now


def _iso(value: datetime | None) -> str | None:
    return None if value is None else from_datetime(value)


_PAYMENT_SELECT = """
  SELECT id, booking_id, bed_request_id, test_order_id, ambulance_request_id,
         amount_poisha, platform_fee_poisha, method::text AS method, state::text AS state,
         paid_at, refunded_poisha, refund_reason, refunded_at, created_at,
         hold_until, failure_reason
    FROM payments
"""


def _to_view(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r["id"],
        "bookingId": r["booking_id"],
        "bedRequestId": r["bed_request_id"],
        "testOrderId": r["test_order_id"],
        "ambulanceRequestId": r["ambulance_request_id"],
        "amountPoisha": r["amount_poisha"],
        "platformFeePoisha": r["platform_fee_poisha"],
        "method": r["method"],
        "state": r["state"],
        "paidAt": _iso(r["paid_at"]),
        "refundedPoisha": r["refunded_poisha"],
        "refundReason": r["refund_reason"],
        "refundedAt": _iso(r["refunded_at"]),
        "createdAt": from_datetime(r["created_at"]),
        "holdUntil": _iso(r["hold_until"]),
        "failureReason": r["failure_reason"],
    }


def find_payment(payment_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(_PAYMENT_SELECT + " WHERE id = %s::uuid AND deleted_at IS NULL", [payment_id])
    return None if row is None else _to_view(row)


def lock_payment(payment_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(_PAYMENT_SELECT + " WHERE id = %s::uuid AND deleted_at IS NULL FOR UPDATE", [payment_id])
    return None if row is None else _to_view(row)


def lock_idempotency_key(key: str) -> None:
    db.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", [f"payment-key:{key}"])


def find_by_idempotency_key(key: str) -> dict[str, Any] | None:
    row = db.fetch_one(_PAYMENT_SELECT + " WHERE idempotency_key = %s", [key])
    return None if row is None else _to_view(row)


def find_by_provider_ref(provider_ref: str) -> dict[str, Any] | None:
    row = db.fetch_one(_PAYMENT_SELECT + " WHERE provider_ref = %s AND deleted_at IS NULL FOR UPDATE", [provider_ref])
    return None if row is None else _to_view(row)


def list_for_booking(booking_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        _PAYMENT_SELECT + " WHERE booking_id = %s::uuid AND deleted_at IS NULL ORDER BY created_at DESC", [booking_id]
    )
    return [_to_view(r) for r in rows]


def insert_payment(
    *,
    booking_id: str | None,
    bed_request_id: str | None,
    test_order_id: str | None,
    ambulance_request_id: str | None,
    payer_user_id: str | None,
    payer_guest_id: str | None,
    amount_poisha: int,
    platform_fee_poisha: int,
    method: str,
    idempotency_key: str,
    created_by: str | None,
    standby_id: str | None = None,
    hold_until: datetime | None = None,
) -> str:
    payment_id = db.fetch_value(
        """
        INSERT INTO payments
          (booking_id, bed_request_id, test_order_id, ambulance_request_id, standby_id,
           payer_user_id, payer_guest_id, amount_poisha, platform_fee_poisha,
           method, idempotency_key, created_by, hold_until)
        VALUES (%s::uuid, %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s, %s,
                %s::payment_method, %s, %s::uuid, %s)
        RETURNING id
        """,
        [
            booking_id,
            bed_request_id,
            test_order_id,
            ambulance_request_id,
            standby_id,
            payer_user_id,
            payer_guest_id,
            amount_poisha,
            platform_fee_poisha,
            method,
            idempotency_key,
            created_by,
            hold_until,
        ],
    )
    if payment_id is None:
        raise RuntimeError("insertPayment returned no row")
    return payment_id


def mark_paid(*, payment_id: str, provider_ref: str | None, at: datetime) -> None:
    db.execute(
        """
        UPDATE payments
           SET state = 'paid'::payment_state,
               failure_reason = NULL,
               provider_ref = COALESCE(provider_ref, %s),
               paid_at = COALESCE(paid_at, %s)
         WHERE id = %s::uuid
        """,
        [provider_ref, at, payment_id],
    )


def mark_failed(payment_id: str, reason: str = "declined") -> None:
    db.execute(
        "UPDATE payments SET state = 'failed'::payment_state, failure_reason = %s WHERE id = %s::uuid",
        [reason, payment_id],
    )


def record_refund(*, payment_id: str, amount_poisha: int, reason: str, at: datetime) -> None:
    db.execute(
        """
        UPDATE payments
           SET refunded_poisha = refunded_poisha + %s,
               refund_reason = %s,
               refunded_at = %s,
               state = CASE
                 WHEN refunded_poisha + %s >= amount_poisha
                   THEN 'refunded'::payment_state
                 ELSE 'partially_refunded'::payment_state
               END
         WHERE id = %s::uuid
        """,
        [amount_poisha, reason, at, amount_poisha, payment_id],
    )


def mark_refund_owed(*, payment_ids: list[str], reason: str) -> int:
    if not payment_ids:
        return 0
    rows = db.fetch_all(
        """
        UPDATE payments
           SET refund_reason = %s
         WHERE id = ANY(%s::uuid[])
           AND state = 'paid'::payment_state
           AND refunded_poisha = 0
           AND refund_reason IS NULL
           AND deleted_at IS NULL
        RETURNING id
        """,
        [reason, list(payment_ids)],
    )
    return len(rows)


def paid_for_session(session_id: str) -> list[dict[str, str]]:
    rows = db.fetch_all(
        """
        SELECT p.id, p.booking_id
          FROM payments p
          JOIN bookings b ON b.id = p.booking_id
         WHERE b.session_id = %s::uuid
           AND p.state = 'paid'::payment_state
           AND p.refunded_poisha = 0
           AND p.deleted_at IS NULL
           AND b.deleted_at IS NULL
           AND b.status NOT IN ('done', 'no_show', 'cancelled')
        """,
        [session_id],
    )
    return [{"paymentId": r["id"], "bookingId": r["booking_id"]} for r in rows]


def doctor_arrived(session_id: str) -> bool:
    return bool(
        db.fetch_value(
            """
            SELECT EXISTS (
              SELECT 1 FROM queue_events
               WHERE session_id = %s::uuid AND type = 'DOCTOR_ARRIVED'::queue_event_type
            ) AS present
            """,
            [session_id],
        )
    )


def settlement_rows(*, hospital_id: str, date_from: str, date_to: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT p.amount_poisha, p.platform_fee_poisha, p.refunded_poisha,
               p.method::text AS method, p.state::text AS state
          FROM payments p
          JOIN bookings b ON b.id = p.booking_id
          JOIN sessions s ON s.id = b.session_id
         WHERE s.hospital_id = %s::uuid
           AND p.deleted_at IS NULL
           AND s.session_date >= %s::date
           AND s.session_date <= %s::date
        """,
        [hospital_id, date_from, date_to],
    )
    return [
        {
            "amountPoisha": r["amount_poisha"],
            "platformFeePoisha": r["platform_fee_poisha"],
            "refundedPoisha": r["refunded_poisha"],
            "method": r["method"],
            "state": r["state"],
        }
        for r in rows
    ]


def bookings_in_period(*, hospital_id: str, date_from: str, date_to: str) -> int:
    value = db.fetch_value(
        """
        SELECT count(*)::text AS count
          FROM bookings b
          JOIN sessions s ON s.id = b.session_id
         WHERE s.hospital_id = %s::uuid
           AND s.session_date >= %s::date
           AND s.session_date <= %s::date
           AND b.deleted_at IS NULL
           AND b.status <> 'cancelled'
        """,
        [hospital_id, date_from, date_to],
    )
    return int(value or "0")


def paid_for_standby(standby_id: str) -> str | None:
    return db.fetch_value(
        """
        SELECT id FROM payments
         WHERE standby_id = %s::uuid
           AND state = 'paid'::payment_state
           AND refunded_poisha = 0
           AND refund_reason IS NULL
           AND deleted_at IS NULL
         LIMIT 1
        """,
        [standby_id],
    )


def move_standby_to_booking(standby_id: str, booking_id: str) -> int:
    rows = db.fetch_all(
        """
        UPDATE payments
           SET booking_id = %s::uuid, standby_id = NULL
         WHERE standby_id = %s::uuid AND deleted_at IS NULL
        RETURNING id
        """,
        [booking_id, standby_id],
    )
    return len(rows)


def unseated_standby_for_session(session_id: str) -> list[str]:
    rows = db.fetch_all(
        """
        SELECT p.id
          FROM payments p
          JOIN standby_list sl ON sl.id = p.standby_id
         WHERE sl.session_id = %s::uuid
           AND p.state = 'paid'::payment_state
           AND p.refunded_poisha = 0
           AND p.refund_reason IS NULL
           AND p.deleted_at IS NULL
        """,
        [session_id],
    )
    return [r["id"] for r in rows]


def refs_of(payment_id: str) -> dict[str, str | None]:
    row = db.fetch_one(
        "SELECT provider_checkout_id, provider_ref FROM payments WHERE id = %s::uuid", [payment_id]
    ) or {}
    return {"checkoutId": row.get("provider_checkout_id"), "providerRef": row.get("provider_ref")}


def set_checkout(payment_id: str, checkout_id: str) -> None:
    db.execute("UPDATE payments SET provider_checkout_id = %s WHERE id = %s::uuid", [checkout_id, payment_id])


def mark_checked(payment_id: str, at: datetime) -> None:
    db.execute("UPDATE payments SET checked_at = %s WHERE id = %s::uuid", [at, payment_id])


def lock_for_booking(booking_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        _PAYMENT_SELECT + " WHERE booking_id = %s::uuid AND deleted_at IS NULL ORDER BY created_at FOR UPDATE",
        [booking_id],
    )
    return [_to_view(r) for r in rows]


def record_event(*, payment_id: str, kind: str, detail: dict[str, str] | None = None, at: datetime | None = None) -> None:
    db.execute(
        """
        INSERT INTO payment_events (payment_id, hospital_id, kind, detail, at)
        SELECT p.id,
               COALESCE(s.hospital_id, ss.hospital_id, br.hospital_id, t.hospital_id),
               %s, %s::jsonb, %s
          FROM payments p
          LEFT JOIN bookings b      ON b.id = p.booking_id
          LEFT JOIN sessions s      ON s.id = b.session_id
          LEFT JOIN standby_list w  ON w.id = p.standby_id
          LEFT JOIN sessions ss     ON ss.id = w.session_id
          LEFT JOIN bed_requests br ON br.id = p.bed_request_id
          LEFT JOIN test_orders t   ON t.id = p.test_order_id
         WHERE p.id = %s::uuid
        """,
        [
            kind,
            json.dumps(detail or {}, ensure_ascii=False, separators=(",", ":")),
            at or utc_now(),
            payment_id,
        ],
    )


def history_of(payment_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        "SELECT kind, detail, at FROM payment_events WHERE payment_id = %s::uuid ORDER BY at, id", [payment_id]
    )
    return [{"kind": r["kind"], "detail": r["detail"], "at": from_datetime(r["at"])} for r in rows]


def hospital_of(payment_id: str) -> str | None:
    return db.fetch_value(
        """
        SELECT COALESCE(s.hospital_id, ss.hospital_id, br.hospital_id, t.hospital_id) AS hospital_id
          FROM payments p
          LEFT JOIN bookings b      ON b.id = p.booking_id
          LEFT JOIN sessions s      ON s.id = b.session_id
          LEFT JOIN standby_list w  ON w.id = p.standby_id
          LEFT JOIN sessions ss     ON ss.id = w.session_id
          LEFT JOIN bed_requests br ON br.id = p.bed_request_id
          LEFT JOIN test_orders t   ON t.id = p.test_order_id
         WHERE p.id = %s::uuid AND p.deleted_at IS NULL
        """,
        [payment_id],
    )


def hospital_pays_first(hospital_id: str) -> bool:
    return bool(db.fetch_value("SELECT prepay_required FROM hospital_settings WHERE hospital_id = %s::uuid", [hospital_id]))


def bookings_with_holds_due(now: datetime, limit: int) -> list[str]:
    rows = db.fetch_all(
        """
        SELECT p.booking_id
          FROM payments p
         WHERE p.booking_id IS NOT NULL
           AND p.hold_until IS NOT NULL
           AND p.hold_until < %s
           AND p.deleted_at IS NULL
           AND p.state IN ('pending', 'failed')
           AND NOT EXISTS (SELECT 1 FROM payment_events e
                            WHERE e.payment_id = p.id AND e.kind = 'expired')
         GROUP BY p.booking_id
         ORDER BY min(p.hold_until)
         LIMIT %s
        """,
        [now, limit],
    )
    return [r["booking_id"] for r in rows]


def expired_to_ask_again(now: datetime, limit: int) -> list[str]:
    rows = db.fetch_all(
        """
        SELECT id
          FROM payments
         WHERE state = 'failed'
           AND failure_reason IN ('expired', 'superseded')
           AND provider_checkout_id IS NOT NULL
           AND hold_until > %s
           AND (checked_at IS NULL OR checked_at < %s)
           AND deleted_at IS NULL
         ORDER BY hold_until
         LIMIT %s
        """,
        [now - timedelta(hours=24), now - timedelta(minutes=15), limit],
    )
    return [r["id"] for r in rows]


def payer_of(payment_id: str) -> dict[str, str | None]:
    row = db.fetch_one("SELECT payer_user_id, payer_guest_id FROM payments WHERE id = %s::uuid", [payment_id]) or {}
    return {"payerUserId": row.get("payer_user_id"), "payerGuestId": row.get("payer_guest_id")}


def prepayment_rules(hospital_id: str) -> dict[str, Any]:
    row = db.fetch_one(
        "SELECT prepay_required, noshow_prepay, noshow_window_days FROM hospital_settings WHERE hospital_id = %s::uuid",
        [hospital_id],
    ) or {}
    return {
        "paysFirst": row.get("prepay_required") or False,
        "noShowRuleOn": row.get("noshow_prepay") or False,
        "windowDays": row.get("noshow_window_days") if row.get("noshow_window_days") is not None else 90,
    }
