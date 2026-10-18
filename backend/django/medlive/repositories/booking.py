"""Bookings (port of `repositories/booking.repo.ts`).

A booking's existence is a row here; what happens to it is the event log's.
`status` and the timestamps beside it are written only from the reducer's
state (`save_projections`).
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from ..core import db
from ..domain.time import from_datetime

ACCOUNT_BOOKING_DAYS = 30


def roster_for(session_id: str) -> list[dict[str, Any]]:
    """The immutable facts a replay starts from, in serial order."""
    rows = db.fetch_all(
        """
        SELECT id, serial_number, patient_id, source, created_at
          FROM bookings
         WHERE session_id = %s AND deleted_at IS NULL
         ORDER BY serial_number, created_at
        """,
        [session_id],
    )
    return [
        {
            "bookingId": r["id"],
            "serial": r["serial_number"],
            "patientId": r["patient_id"],
            "source": r["source"],
            "createdAt": from_datetime(r["created_at"]),
        }
        for r in rows
    ]


_DISPLAY_SELECT = """
  SELECT b.id, b.session_id, b.patient_id, b.serial_number, b.status,
         b.source, b.fee_poisha, b.created_at, p.full_name
    FROM bookings b
    JOIN patients p ON p.id = b.patient_id
"""


def _to_booking_row(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r["id"],
        "sessionId": r["session_id"],
        "patientId": r["patient_id"],
        "patientName": r["full_name"],
        "serial": r["serial_number"],
        "status": r["status"],
        "source": r["source"],
        "feePoisha": r["fee_poisha"],
        "createdAt": from_datetime(r["created_at"]),
    }


def list_for_session(session_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        _DISPLAY_SELECT + " WHERE b.session_id = %s AND b.deleted_at IS NULL ORDER BY b.serial_number",
        [session_id],
    )
    return [_to_booking_row(r) for r in rows]


def find_by_id(booking_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(_DISPLAY_SELECT + " WHERE b.id = %s AND b.deleted_at IS NULL", [booking_id])
    return None if row is None else _to_booking_row(row)


def find_detail(booking_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT b.id, b.session_id, b.serial_number, b.status, b.fee_poisha,
               b.patient_id, p.full_name,
               h.id   AS hospital_id,
               h.name_bn AS hospital_name_bn,
               h.name_en AS hospital_name_en,
               d.full_name_bn AS doctor_name_bn,
               d.full_name_en AS doctor_name_en,
               dep.code  AS department_code,
               s.room, s.session_date, s.planned_start, s.planned_end,
               hs.stale_threshold_minutes,
               hs.refund_policy,
               b.prepayment_required,
               hs.payment_hold_minutes
          FROM bookings b
          JOIN patients p    ON p.id = b.patient_id
          JOIN sessions s    ON s.id = b.session_id
          JOIN hospitals h   ON h.id = s.hospital_id
          JOIN doctors d     ON d.id = s.doctor_id
          JOIN departments dep ON dep.id = s.department_id
          LEFT JOIN hospital_settings hs ON hs.hospital_id = h.id
         WHERE b.id = %s AND b.deleted_at IS NULL
        """,
        [booking_id],
    )
    if row is None:
        return None
    return {
        "id": row["id"],
        "sessionId": row["session_id"],
        "serial": row["serial_number"],
        "status": row["status"],
        "patientId": row["patient_id"],
        "patientName": row["full_name"],
        "feePoisha": row["fee_poisha"],
        "hospitalId": row["hospital_id"],
        "hospitalNameBn": row["hospital_name_bn"],
        "hospitalNameEn": row["hospital_name_en"],
        "doctorNameBn": row["doctor_name_bn"],
        "doctorNameEn": row["doctor_name_en"],
        "departmentCode": row["department_code"],
        "room": row["room"],
        "sessionDate": row["session_date"],
        "plannedStart": from_datetime(row["planned_start"]),
        "plannedEnd": from_datetime(row["planned_end"]),
        "staleThresholdMinutes": row["stale_threshold_minutes"]
        if row["stale_threshold_minutes"] is not None
        else 10,
        "refundPolicy": row["refund_policy"] if row["refund_policy"] is not None else {},
        "prepaymentRequired": row["prepayment_required"],
        "paymentHoldMinutes": row["payment_hold_minutes"] if row["payment_hold_minutes"] is not None else 15,
    }


def save_projections(projections: list[dict[str, Any]]) -> None:
    """Writes each booking's settled state from the reducer, touching only rows that changed."""
    if not projections:
        return
    placeholders = []
    params: list[Any] = []
    for p in projections:
        placeholders.append(
            "(%s::uuid, %s::booking_status, %s::timestamptz, %s::timestamptz, %s::timestamptz, "
            "%s::integer, %s::integer, %s::text)"
        )
        params.extend(
            [
                p["bookingId"],
                p["status"],
                p["calledAt"],
                p["doneAt"],
                p["arrivedAt"],
                p["quotedWaitMinutes"],
                p["consultSeconds"],
                p["cancelledReason"],
            ]
        )
    db.execute(
        f"""
        UPDATE bookings AS b
           SET status           = v.status,
               called_at        = v.called_at,
               done_at          = v.done_at,
               arrived_at       = v.arrived_at,
               quoted_wait_minutes = v.quoted_wait_minutes,
               consult_seconds  = v.consult_seconds,
               cancelled_reason = COALESCE(v.cancelled_reason, b.cancelled_reason)
          FROM (VALUES {", ".join(placeholders)})
               AS v (id, status, called_at, done_at, arrived_at, quoted_wait_minutes,
                     consult_seconds, cancelled_reason)
         WHERE b.id = v.id
           AND (b.status           IS DISTINCT FROM v.status
             OR b.called_at        IS DISTINCT FROM v.called_at
             OR b.done_at          IS DISTINCT FROM v.done_at
             OR b.arrived_at       IS DISTINCT FROM v.arrived_at
             OR b.quoted_wait_minutes IS DISTINCT FROM v.quoted_wait_minutes
             OR b.consult_seconds  IS DISTINCT FROM v.consult_seconds
             OR b.cancelled_reason IS DISTINCT FROM COALESCE(v.cancelled_reason, b.cancelled_reason))
        """,
        params,
    )


def insert_walkin(*, session_id: str, patient_id: str, serial: int, fee_poisha: int, created_by_staff_id: str) -> str:
    return db.fetch_value(
        """
        INSERT INTO bookings (session_id, patient_id, serial_number, source, fee_poisha, created_by)
        VALUES (%s, %s, %s, 'walkin', %s, %s)
        RETURNING id
        """,
        [session_id, patient_id, serial, fee_poisha, created_by_staff_id],
    )


def insert_booking(
    *,
    session_id: str,
    patient_id: str,
    serial: int,
    source: str,
    fee_poisha: int,
    booked_by_user_id: str | None,
    booked_by_guest_id: str | None,
    reason_text: str | None,
    intake: dict[str, Any],
    idempotency_key: str | None = None,
    prepayment_required: bool = False,
    arrival_window_start: str | None = None,
) -> str:
    booking_id = db.fetch_value(
        """
        INSERT INTO bookings
          (session_id, patient_id, serial_number, source, fee_poisha,
           booked_by_user_id, booked_by_guest_id, reason_text, intake, idempotency_key,
           prepayment_required, arrival_window_start)
        VALUES (%s, %s, %s, %s::booking_source, %s, %s, %s, %s, %s::jsonb, %s, %s, %s::timestamptz)
        RETURNING id
        """,
        [
            session_id,
            patient_id,
            serial,
            source,
            fee_poisha,
            booked_by_user_id,
            booked_by_guest_id,
            reason_text,
            json.dumps(intake, ensure_ascii=False, separators=(",", ":")),
            idempotency_key,
            prepayment_required,
            arrival_window_start,
        ],
    )
    if booking_id is None:
        raise RuntimeError("bookings insert returned no id.")
    return booking_id


def find_by_idempotency_key(idempotency_key: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        "SELECT id, session_id, patient_id, serial_number FROM bookings WHERE idempotency_key = %s",
        [idempotency_key],
    )
    if row is None:
        return None
    return {
        "id": row["id"],
        "sessionId": row["session_id"],
        "patientId": row["patient_id"],
        "serial": row["serial_number"],
    }


def count_guest_bookings_since(guest_id: str, since: datetime) -> int:
    value = db.fetch_value(
        "SELECT count(*)::text AS n FROM bookings WHERE booked_by_guest_id = %s AND created_at > %s",
        [guest_id, since],
    )
    return int(value or "0")


def find_same_doctor_same_day(*, patient_id: str, doctor_id: str, session_date: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT b.id, b.serial_number
          FROM bookings b
          JOIN sessions s ON s.id = b.session_id
         WHERE b.patient_id = %s
           AND s.doctor_id = %s
           AND s.session_date = %s::date
           AND b.status NOT IN ('cancelled', 'rescheduled')
           AND b.deleted_at IS NULL
         LIMIT 1
        """,
        [patient_id, doctor_id, session_date],
    )
    return None if row is None else {"id": row["id"], "serial": row["serial_number"]}


def patient_belongs_to(patient_id: str, user_id: str) -> bool:
    return (
        db.fetch_one(
            "SELECT 1 AS present FROM patients WHERE id = %s AND owner_user_id = %s AND deleted_at IS NULL",
            [patient_id, user_id],
        )
        is not None
    )


def exists_for_principal(session_id: str, *, user_id: str | None, booking_id: str | None) -> bool:
    return (
        db.fetch_one(
            """
            SELECT 1 AS present
              FROM bookings
             WHERE session_id = %s
               AND deleted_at IS NULL
               AND (
                 (%s::uuid IS NOT NULL AND id = %s::uuid)
                 OR (%s::uuid IS NOT NULL AND booked_by_user_id = %s::uuid)
               )
             LIMIT 1
            """,
            [session_id, booking_id, booking_id, user_id, user_id],
        )
        is not None
    )


def owner_of(booking_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT booked_by_user_id, booked_by_guest_id, patient_id
          FROM bookings
         WHERE id = %s AND deleted_at IS NULL
        """,
        [booking_id],
    )
    if row is None:
        return None
    return {"userId": row["booked_by_user_id"], "guestId": row["booked_by_guest_id"], "patientId": row["patient_id"]}


def list_for_account(user_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT b.id, b.session_id, b.serial_number, b.status, s.status AS session_status,
               b.patient_id, p.full_name,
               h.id AS hospital_id, h.name_bn AS hospital_name_bn, h.name_en AS hospital_name_en,
               d.full_name_bn AS doctor_name_bn, d.full_name_en AS doctor_name_en,
               s.session_date, s.planned_start, s.planned_end,
               (SELECT x.serial_number FROM bookings x
                 WHERE x.session_id = b.session_id AND x.status = 'in_chamber'
                   AND x.deleted_at IS NULL
                 ORDER BY x.serial_number LIMIT 1) AS now_serving
          FROM bookings b
          JOIN patients p  ON p.id = b.patient_id
          JOIN sessions s  ON s.id = b.session_id
          JOIN hospitals h ON h.id = s.hospital_id
          JOIN doctors d   ON d.id = s.doctor_id
         WHERE p.owner_user_id = %s AND p.deleted_at IS NULL AND b.deleted_at IS NULL
           AND s.session_date >= (now() AT TIME ZONE 'Asia/Dhaka')::date - %s::int
         ORDER BY s.planned_start DESC, b.created_at DESC
         LIMIT 100
        """,
        [user_id, ACCOUNT_BOOKING_DAYS],
    )
    return [
        {
            "bookingId": r["id"],
            "sessionId": r["session_id"],
            "serial": r["serial_number"],
            "status": r["status"],
            "sessionStatus": r["session_status"],
            "patientId": r["patient_id"],
            "patientName": r["full_name"],
            "hospitalId": r["hospital_id"],
            "hospitalNameBn": r["hospital_name_bn"],
            "hospitalNameEn": r["hospital_name_en"],
            "doctorNameBn": r["doctor_name_bn"],
            "doctorNameEn": r["doctor_name_en"],
            "sessionDate": r["session_date"],
            "plannedStart": from_datetime(r["planned_start"]),
            "plannedEnd": from_datetime(r["planned_end"]),
            "nowServing": r["now_serving"],
        }
        for r in rows
    ]


def owned_by_account(booking_id: str, user_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT b.session_id, s.planned_end, p.full_name
          FROM bookings b
          JOIN patients p ON p.id = b.patient_id
          JOIN sessions s ON s.id = b.session_id
         WHERE b.id = %s AND b.deleted_at IS NULL
           AND p.owner_user_id = %s AND p.deleted_at IS NULL
        """,
        [booking_id, user_id],
    )
    if row is None:
        return None
    return {"sessionId": row["session_id"], "plannedEnd": row["planned_end"], "patientName": row["full_name"]}


def count_no_shows_at(*, guest_id: str, hospital_id: str, since: str) -> int:
    value = db.fetch_value(
        """
        SELECT count(*)::text AS n
          FROM bookings b
          JOIN sessions s ON s.id = b.session_id
         WHERE b.booked_by_guest_id = %s::uuid
           AND s.hospital_id = %s::uuid
           AND b.status = 'no_show'
           AND b.deleted_at IS NULL
           AND s.session_date >= %s::date
        """,
        [guest_id, hospital_id, since],
    )
    return int(value or "0")


def offers_arrival_windows(hospital_id: str) -> bool:
    value = db.fetch_value("SELECT fn_offers_arrival_windows(%s::uuid) AS offers", [hospital_id])
    return bool(value)
