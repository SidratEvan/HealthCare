"""The standby list and freed-slot offers (port of `repositories/standby.repo.ts`;
FR-QUE-30, FR-PAT-25..27)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ..core import db

_PREPAID = """EXISTS (
  SELECT 1 FROM payments p
   WHERE p.standby_id = sl.id
     AND p.state = 'paid'::payment_state
     AND p.refunded_poisha = 0
     AND p.refund_reason IS NULL
     AND p.deleted_at IS NULL
)"""

_STANDBY_COLUMNS = f"sl.id, sl.session_id, sl.patient_id, sl.contact_phone, sl.position, sl.guest_id, {_PREPAID} AS prepaid"

_OFFER_COLUMNS = """id, session_id, freed_booking_id, offered_to_patient_id,
       offered_at, expires_at, accepted_at, declined_at, recovered_value_poisha"""


def _to_standby(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "sessionId": row["session_id"],
        "patientId": row["patient_id"],
        "contactPhone": row["contact_phone"],
        "position": row["position"],
        "guestId": row["guest_id"],
        "prepaid": row["prepaid"],
    }


def _to_offer(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "sessionId": row["session_id"],
        "freedBookingId": row["freed_booking_id"],
        "offeredToPatientId": row["offered_to_patient_id"],
        "offeredAt": row["offered_at"],
        "expiresAt": row["expires_at"],
        "acceptedAt": row["accepted_at"],
        "declinedAt": row["declined_at"],
        "recoveredValuePoisha": row["recovered_value_poisha"],
    }


def claim_next_standby(session_id: str, now: datetime) -> dict[str, Any] | None:
    """The next person to offer a chair to, locked so a second caller skips them."""
    row = db.fetch_one(
        f"""
        SELECT {_STANDBY_COLUMNS}
          FROM standby_list sl
         WHERE sl.session_id = %s
           AND sl.removed_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM slot_offers o
              WHERE o.offered_to_patient_id = sl.patient_id
                AND o.session_id = sl.session_id
                AND o.accepted_at IS NULL
                AND o.declined_at IS NULL
                AND o.expires_at > %s
           )
         ORDER BY (
                   SELECT count(*) FROM slot_offers o
                    WHERE o.offered_to_patient_id = sl.patient_id
                      AND o.session_id = sl.session_id
                      AND o.accepted_at IS NULL
                  ),
                  sl.position
         FOR UPDATE SKIP LOCKED
         LIMIT 1
        """,
        [session_id, now],
    )
    return None if row is None else _to_standby(row)


def list_standby(session_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        f"""
        SELECT {_STANDBY_COLUMNS}
          FROM standby_list sl
         WHERE sl.session_id = %s AND sl.removed_at IS NULL
         ORDER BY sl.position
        """,
        [session_id],
    )
    return [_to_standby(r) for r in rows]


def find_standby(standby_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        f"""
        SELECT {_STANDBY_COLUMNS}, sl.removed_at, sl.seated_booking_id
          FROM standby_list sl
         WHERE sl.id = %s
        """,
        [standby_id],
    )
    if row is None:
        return None
    return {**_to_standby(row), "removedAt": row["removed_at"], "seatedBookingId": row["seated_booking_id"]}


def find_by_idempotency_key(key: str) -> str | None:
    return db.fetch_value("SELECT id FROM standby_list WHERE idempotency_key = %s", [key])


def active_for(session_id: str, patient_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        f"""
        SELECT {_STANDBY_COLUMNS}
          FROM standby_list sl
         WHERE sl.session_id = %s AND sl.patient_id = %s AND sl.removed_at IS NULL
        """,
        [session_id, patient_id],
    )
    return None if row is None else _to_standby(row)


def insert_standby(
    *, session_id: str, patient_id: str, guest_id: str | None, contact_phone: str, idempotency_key: str | None
) -> dict[str, Any]:
    row = db.fetch_one(
        """
        INSERT INTO standby_list
          (session_id, patient_id, guest_id, contact_phone, position, idempotency_key)
        SELECT %s::uuid, %s::uuid, %s::uuid, %s, coalesce(max(position), 0) + 1, %s
          FROM standby_list
         WHERE session_id = %s::uuid AND removed_at IS NULL
        RETURNING id, position
        """,
        [session_id, patient_id, guest_id, contact_phone, idempotency_key, session_id],
    )
    if row is None:
        raise RuntimeError("insertStandby returned no row")
    return {"id": row["id"], "position": row["position"]}


def ahead_of(session_id: str, position: int) -> int:
    value = db.fetch_value(
        """
        SELECT count(*)::text AS n FROM standby_list
         WHERE session_id = %s AND removed_at IS NULL AND position < %s
        """,
        [session_id, position],
    )
    return int(value or 0)


def mark_seated(standby_id: str, booking_id: str, at: datetime) -> None:
    db.execute(
        "UPDATE standby_list SET removed_at = %s, seated_booking_id = %s WHERE id = %s",
        [at, booking_id, standby_id],
    )


def leave(standby_id: str, at: datetime) -> bool:
    return (
        db.execute(
            "UPDATE standby_list SET removed_at = %s WHERE id = %s AND removed_at IS NULL",
            [at, standby_id],
        )
        == 1
    )


def open_offer_for(session_id: str, patient_id: str, now: datetime) -> dict[str, Any] | None:
    row = db.fetch_one(
        f"""
        SELECT {_OFFER_COLUMNS}
          FROM slot_offers
         WHERE session_id = %s
           AND offered_to_patient_id = %s
           AND accepted_at IS NULL
           AND declined_at IS NULL
           AND expires_at > %s
         ORDER BY offered_at DESC
         LIMIT 1
        """,
        [session_id, patient_id, now],
    )
    return None if row is None else _to_offer(row)


def mark_declined(offer_id: str, at: datetime) -> bool:
    return (
        db.execute(
            """
            UPDATE slot_offers SET declined_at = %s
             WHERE id = %s AND accepted_at IS NULL AND declined_at IS NULL
            """,
            [at, offer_id],
        )
        == 1
    )


def insert_offer(*, session_id: str, freed_booking_id: str, offered_to_patient_id: str, expires_at: datetime) -> str:
    return db.fetch_value(
        """
        INSERT INTO slot_offers (session_id, freed_booking_id, offered_to_patient_id, expires_at)
        VALUES (%s, %s, %s, %s)
        RETURNING id
        """,
        [session_id, freed_booking_id, offered_to_patient_id, expires_at],
    )


def mark_accepted(offer_id: str, recovered_value_poisha: int, at: datetime) -> bool:
    """The row-level guard: the second accept of one offer finds nothing to update."""
    return (
        db.execute(
            """
            UPDATE slot_offers SET accepted_at = %s, recovered_value_poisha = %s
             WHERE id = %s AND accepted_at IS NULL AND declined_at IS NULL
            """,
            [at, recovered_value_poisha, offer_id],
        )
        == 1
    )


def remove_from_standby(session_id: str, patient_id: str, at: datetime) -> None:
    db.execute(
        """
        UPDATE standby_list SET removed_at = %s
         WHERE session_id = %s AND patient_id = %s AND removed_at IS NULL
        """,
        [at, session_id, patient_id],
    )


def find_offer(offer_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(f"SELECT {_OFFER_COLUMNS} FROM slot_offers WHERE id = %s", [offer_id])
    return None if row is None else _to_offer(row)


def sessions_with_overdue_offers(at: datetime) -> list[str]:
    rows = db.fetch_all(
        """
        SELECT DISTINCT o.session_id
          FROM slot_offers o
         WHERE o.accepted_at IS NULL
           AND o.declined_at IS NULL
           AND o.expires_at <= %s
           AND o.expires_at > %s::timestamptz - interval '1 day'
           AND NOT EXISTS (
                 SELECT 1 FROM queue_events e
                  WHERE e.session_id = o.session_id
                    AND e.type = 'SLOT_EXPIRED'
                    AND e.payload ->> 'offerId' = o.id::text)
        """,
        [at, at],
    )
    return [r["session_id"] for r in rows]


def list_offers(session_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        f"SELECT {_OFFER_COLUMNS} FROM slot_offers WHERE session_id = %s ORDER BY offered_at DESC",
        [session_id],
    )
    return [_to_offer(r) for r in rows]
