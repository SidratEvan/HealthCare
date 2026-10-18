"""The notification outbox and what a message needs to know (port of `repositories/notification.repo.ts`).

Rows are written in the same transaction as the fact they announce, and sent
after it commits (BACKEND.md §8). What is kept of a message once sent is its
correlation ids and its words without credentials (`forTheRecord`).
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from ..core import db
from ..domain.time import from_datetime


def active_templates() -> list[dict[str, Any]]:
    rows = db.fetch_all(
        "SELECT key, channel::text AS channel, locale, body, version FROM notification_templates WHERE is_active"
    )
    return [dict(r) for r in rows]


def _addressee(recipient: dict[str, Any], column: str) -> str | None:
    if recipient.get("patientId") is not None:
        return None
    if column == "guest":
        return recipient.get("guestId")
    return recipient.get("userId") if recipient.get("guestId") is None else None


def queue_all(notifications: list[dict[str, Any]]) -> list[str]:
    """Writes a batch of outbox rows; their ids, in order."""
    if not notifications:
        return []
    placeholders = []
    params: list[Any] = []
    for n in notifications:
        placeholders.append(
            "(%s::uuid, %s::uuid, %s::uuid, %s::text, %s::notif_channel, %s::text, %s::jsonb, "
            "%s::notif_state, %s::text, coalesce(%s::timestamptz, now()))"
        )
        recipient = n["recipient"]
        skipped = n["skipped"]
        held_until = n["heldUntil"]
        params.extend(
            [
                recipient.get("patientId"),
                _addressee(recipient, "guest"),
                _addressee(recipient, "user"),
                recipient.get("phone"),
                n["channel"],
                n["templateKey"],
                json.dumps({**n["params"], "body": n["body"]}, ensure_ascii=False, separators=(",", ":")),
                "queued" if skipped is None else "skipped",
                skipped if skipped is not None else (None if held_until is None else "quiet_hours"),
                held_until,
            ]
        )
    rows = db.fetch_all(
        f"""
        INSERT INTO notifications
          (recipient_patient_id, recipient_guest_id, recipient_user_id, phone,
           channel, template_key, params, state, error, next_attempt_at)
        VALUES {", ".join(placeholders)}
        RETURNING id
        """,
        params,
    )
    return [r["id"] for r in rows]


def mark_sent(notification_id: str, *, provider_ref: str, cost_poisha: int | None) -> None:
    db.execute(
        """
        UPDATE notifications
           SET state = 'sent', sent_at = now(), error = NULL,
               provider_ref = %s, cost_poisha = %s
         WHERE id = %s::uuid AND state = 'queued'
        """,
        [provider_ref, cost_poisha, notification_id],
    )


def apply_receipt(provider_ref: str, outcome: str, error: str) -> bool:
    if outcome == "delivered":
        rows = db.fetch_all(
            """
            UPDATE notifications
               SET state = 'delivered', delivered_at = greatest(now(), sent_at)
             WHERE provider_ref = %s AND channel = 'sms' AND state = 'sent'
            RETURNING id
            """,
            [provider_ref],
        )
    else:
        rows = db.fetch_all(
            """
            UPDATE notifications
               SET state = 'failed', error = %s
             WHERE provider_ref = %s AND channel = 'sms' AND state = 'sent'
            RETURNING id
            """,
            [error, provider_ref],
        )
    return len(rows) > 0


def month_of_messages(hospital_id: str) -> dict[str, int]:
    row = db.fetch_one(
        """
        SELECT count(*) FILTER (WHERE n.state IN ('sent', 'delivered'))::int AS sent,
               count(*) FILTER (WHERE n.state = 'delivered')::int AS delivered,
               count(*) FILTER (WHERE n.state = 'failed')::int AS failed,
               count(*) FILTER (WHERE n.state = 'skipped')::int AS held,
               count(*) FILTER (WHERE n.state = 'queued')::int AS waiting
          FROM notifications n
          JOIN bookings b ON b.id = (n.params ->> 'bookingId')::uuid
          JOIN sessions s ON s.id = b.session_id
         WHERE s.hospital_id = %s::uuid
           AND n.channel = 'sms'
           AND n.queued_at >= date_trunc('month', now())
        """,
        [hospital_id],
    ) or {}
    return {key: row.get(key) or 0 for key in ("sent", "delivered", "failed", "held", "waiting")}


def claim_due(limit: int, claim_seconds: int) -> list[dict[str, Any]]:
    """Claims due rows for sending, skipping rows another sender holds."""
    rows = db.fetch_all(
        """
        UPDATE notifications n
           SET attempts = n.attempts + 1,
               next_attempt_at = now() + make_interval(secs => %s)
         WHERE n.id IN (
                 SELECT id FROM notifications
                  WHERE state = 'queued' AND next_attempt_at <= now()
                  ORDER BY next_attempt_at
                  LIMIT %s
                    FOR UPDATE SKIP LOCKED)
        RETURNING n.id, n.channel::text AS channel, n.template_key, n.params, n.phone, n.attempts,
                  n.recipient_patient_id, n.recipient_guest_id, n.recipient_user_id
        """,
        [claim_seconds, limit],
    )
    return [
        {
            "id": r["id"],
            "channel": r["channel"],
            "templateKey": r["template_key"],
            "params": r["params"],
            "phone": r["phone"],
            "attempts": r["attempts"],
            "recipient": {
                "patientId": r["recipient_patient_id"],
                "guestId": r["recipient_guest_id"],
                "userId": r["recipient_user_id"],
                "phone": r["phone"],
                "locale": "bn",
            },
        }
        for r in rows
    ]


def retry_at(notification_id: str, at: datetime, error: str) -> None:
    db.execute(
        "UPDATE notifications SET next_attempt_at = %s, error = %s WHERE id = %s::uuid AND state = 'queued'",
        [at, error, notification_id],
    )


def mark_not_sent(notification_id: str, state: str, error: str) -> None:
    db.execute(
        "UPDATE notifications SET state = %s::notif_state, error = %s WHERE id = %s::uuid AND state = 'queued'",
        [state, error, notification_id],
    )


def clear_bodies_older_than(days: int, keep: list[str], limit: int) -> int:
    rows = db.fetch_all(
        """
        UPDATE notifications n
           SET params = COALESCE(
                 (SELECT jsonb_object_agg(kept.key, kept.value)
                    FROM jsonb_each(n.params) AS kept
                   WHERE kept.key = ANY(%s::text[])),
                 '{}'::jsonb
               )
         WHERE n.id IN (
                 SELECT id
                   FROM notifications
                  WHERE params ? 'body'
                    AND queued_at < now() - (%s::int * interval '1 day')
                  ORDER BY queued_at
                  LIMIT %s::int
               )
        RETURNING n.id
        """,
        [list(keep), days, limit],
    )
    return len(rows)


def already_notified(session_id: str, template_key: str) -> set[str]:
    rows = db.fetch_all(
        """
        SELECT DISTINCT n.params ->> 'bookingId' AS booking_id
          FROM notifications n
         WHERE n.template_key = %s
           AND (n.params ->> 'bookingId')::uuid IN (
                 SELECT id FROM bookings WHERE session_id = %s::uuid
               )
        """,
        [template_key, session_id],
    )
    return {r["booking_id"] for r in rows}


def told_etas(session_id: str) -> dict[str, datetime]:
    rows = db.fetch_all(
        """
        SELECT id, told_eta_at FROM bookings
         WHERE session_id = %s::uuid AND told_eta_at IS NOT NULL AND deleted_at IS NULL
        """,
        [session_id],
    )
    return {r["id"]: r["told_eta_at"] for r in rows}


def set_told_etas(told: list[dict[str, str]]) -> None:
    if not told:
        return
    db.execute(
        """
        UPDATE bookings b
           SET told_eta_at = t.eta_at
          FROM unnest(%s::uuid[], %s::timestamptz[]) AS t(id, eta_at)
         WHERE b.id = t.id
        """,
        [[entry["bookingId"] for entry in told], [entry["etaAt"] for entry in told]],
    )


def chamber_for(session_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT h.id AS hospital_id,
               h.name_bn AS hospital_name_bn,
               h.name_en AS hospital_name_en,
               d.full_name_bn AS doctor_name_bn,
               d.full_name_en AS doctor_name_en,
               s.room, s.planned_start, s.session_date,
               hs.sms_budget_monthly
          FROM sessions s
          JOIN hospitals h ON h.id = s.hospital_id
          JOIN doctors d   ON d.id = s.doctor_id
          LEFT JOIN hospital_settings hs ON hs.hospital_id = h.id
         WHERE s.id = %s::uuid
        """,
        [session_id],
    )
    if row is None:
        return None
    return {
        "hospitalId": row["hospital_id"],
        "hospitalNameBn": row["hospital_name_bn"],
        "hospitalNameEn": row["hospital_name_en"],
        "doctorNameBn": row["doctor_name_bn"],
        "doctorNameEn": row["doctor_name_en"],
        "room": row["room"],
        "plannedStart": from_datetime(row["planned_start"]),
        "sessionDate": row["session_date"],
        "smsBudgetMonthly": row["sms_budget_monthly"],
    }


def recipients_for_session(session_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT b.id AS booking_id, b.serial_number, b.patient_id,
               b.booked_by_guest_id AS guest_id,
               b.booked_by_user_id  AS user_id,
               COALESCE(p.phone, g.phone, u.phone) AS phone,
               u.locale
          FROM bookings b
          JOIN patients p ON p.id = b.patient_id
          LEFT JOIN guest_identities g ON g.id = b.booked_by_guest_id
          LEFT JOIN users u            ON u.id = b.booked_by_user_id
         WHERE b.session_id = %s::uuid AND b.deleted_at IS NULL
        """,
        [session_id],
    )
    return [
        {
            "bookingId": r["booking_id"],
            "serial": r["serial_number"],
            "patientId": r["patient_id"],
            "guestId": r["guest_id"],
            "userId": r["user_id"],
            "phone": r["phone"],
            "locale": r["locale"] or "bn",
        }
        for r in rows
    ]


def device_tokens_for(recipient: dict[str, Any]) -> list[str]:
    user_id = recipient.get("userId")
    guest_id = recipient.get("guestId")
    if user_id is None and guest_id is None:
        return []
    rows = db.fetch_all(
        """
        SELECT token FROM device_tokens
         WHERE revoked_at IS NULL
           AND (
             (%s::uuid  IS NOT NULL AND user_id  = %s::uuid)
             OR (%s::uuid IS NOT NULL AND guest_id = %s::uuid)
           )
        """,
        [user_id, user_id, guest_id, guest_id],
    )
    return [r["token"] for r in rows]


def sms_sent_this_month(hospital_id: str) -> int:
    value = db.fetch_value(
        """
        SELECT count(*)::text AS n
          FROM notifications n
          JOIN bookings b  ON b.id = (n.params ->> 'bookingId')::uuid
          JOIN sessions s  ON s.id = b.session_id
         WHERE s.hospital_id = %s::uuid
           AND n.channel = 'sms'
           AND n.state IN ('sent', 'delivered')
           AND n.queued_at >= date_trunc('month', now())
        """,
        [hospital_id],
    )
    return int(value or "0")


def list_for_session(session_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT n.id, n.template_key, n.channel::text AS channel, n.state::text AS state,
               n.error, n.params
          FROM notifications n
         WHERE (n.params ->> 'bookingId')::uuid IN (
                 SELECT id FROM bookings WHERE session_id = %s::uuid
               )
         ORDER BY n.queued_at, n.id
        """,
        [session_id],
    )
    return [
        {
            "id": r["id"],
            "templateKey": r["template_key"],
            "channel": r["channel"],
            "state": r["state"],
            "error": r["error"],
            "params": r["params"],
        }
        for r in rows
    ]


def _recipient(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "patientId": row["patient_id"],
        "guestId": row.get("guest_id"),
        "userId": row.get("user_id"),
        "phone": row["phone"],
        "locale": row.get("locale") or "bn",
    }


def report_recipient(test_order_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT t.patient_id, b.booked_by_guest_id AS guest_id, b.booked_by_user_id AS user_id,
               COALESCE(p.phone, g.phone, u.phone) AS phone, u.locale,
               h.id AS hospital_id, h.name_bn, h.name_en, t.test_name,
               v.doctor_id, s.sms_budget_monthly
          FROM test_orders t
          JOIN patients p ON p.id = t.patient_id
          JOIN hospitals h ON h.id = t.hospital_id
          LEFT JOIN visits v ON v.id = t.visit_id
          LEFT JOIN bookings b ON b.id = v.booking_id
          LEFT JOIN guest_identities g ON g.id = b.booked_by_guest_id
          LEFT JOIN users u ON u.id = b.booked_by_user_id
          LEFT JOIN hospital_settings s ON s.hospital_id = t.hospital_id
         WHERE t.id = %s::uuid
        """,
        [test_order_id],
    )
    if row is None:
        return None
    return {
        "recipient": _recipient(row),
        "hospitalId": row["hospital_id"],
        "hospitalNameBn": row["name_bn"],
        "hospitalNameEn": row["name_en"],
        "testName": row["test_name"],
        "orderingDoctorId": row["doctor_id"],
        "smsBudgetMonthly": row["sms_budget_monthly"],
    }


def bed_request_recipient(request_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT r.patient_id, r.requested_by_guest_id AS guest_id, r.requested_by_user_id AS user_id,
               COALESCE(p.phone, g.phone, u.phone) AS phone, u.locale,
               h.id AS hospital_id, h.name_bn, h.name_en, r.bed_kind::text AS bed_kind,
               s.sms_budget_monthly
          FROM bed_requests r
          JOIN patients p ON p.id = r.patient_id
          JOIN hospitals h ON h.id = r.hospital_id
          LEFT JOIN guest_identities g ON g.id = r.requested_by_guest_id
          LEFT JOIN users u ON u.id = r.requested_by_user_id
          LEFT JOIN hospital_settings s ON s.hospital_id = r.hospital_id
         WHERE r.id = %s::uuid
        """,
        [request_id],
    )
    if row is None:
        return None
    return {
        "recipient": _recipient(row),
        "hospitalId": row["hospital_id"],
        "hospitalNameBn": row["name_bn"],
        "hospitalNameEn": row["name_en"],
        "bedKind": row["bed_kind"],
        "smsBudgetMonthly": row["sms_budget_monthly"],
    }


def emergency_recipient(case_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT ec.patient_id, ec.contact_phone, h.id AS hospital_id, h.name_bn, h.name_en,
               s.sms_budget_monthly
          FROM emergency_cases ec
          JOIN hospitals h ON h.id = ec.hospital_id
          LEFT JOIN hospital_settings s ON s.hospital_id = ec.hospital_id
         WHERE ec.id = %s::uuid
        """,
        [case_id],
    )
    if row is None:
        return None
    return {
        "recipient": {
            "patientId": row["patient_id"],
            "guestId": None,
            "userId": None,
            "phone": row["contact_phone"],
            "locale": "bn",
        },
        "hospitalId": row["hospital_id"],
        "hospitalNameBn": row["name_bn"],
        "hospitalNameEn": row["name_en"],
        "smsBudgetMonthly": row["sms_budget_monthly"],
    }
