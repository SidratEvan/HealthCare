"""Guest identities, the patients they book for, and tracking links
(port of `repositories/guest.repo.ts`; FR-GST-*)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ..core import db

MAX_LIVE_LINKS_PER_BOOKING = 4


def find_or_create_identity(*, phone: str, display_name: str) -> str:
    identity = db.fetch_value(
        """
        INSERT INTO guest_identities (phone, display_name)
        VALUES (%s, %s)
        ON CONFLICT (phone) WHERE deleted_at IS NULL
          DO UPDATE SET display_name = COALESCE(guest_identities.display_name, excluded.display_name)
        RETURNING id
        """,
        [phone, display_name],
    )
    if identity is None:
        raise RuntimeError("guest_identities upsert returned no id.")
    return identity


def identity_id_for_phone(phone: str) -> str | None:
    return db.fetch_value("SELECT id FROM guest_identities WHERE phone = %s AND deleted_at IS NULL", [phone])


def find_or_create_patient(*, guest_id: str, full_name: str, age_years: int, sex: str, phone: str) -> str:
    found = db.fetch_value(
        """
        SELECT id FROM patients
         WHERE owner_guest_id = %s AND full_name = %s AND deleted_at IS NULL
         LIMIT 1
        """,
        [guest_id, full_name],
    )
    if found is not None:
        return found
    count = db.fetch_value(
        "SELECT count(*)::text AS n FROM patients WHERE owner_guest_id = %s AND deleted_at IS NULL", [guest_id]
    )
    primary = int(count if count is not None else "1") == 0
    created = db.fetch_value(
        """
        INSERT INTO patients
          (owner_guest_id, full_name, age_years, sex, phone, relationship, is_primary)
        VALUES (%s, %s, %s, %s::sex, %s, %s, %s)
        RETURNING id
        """,
        [guest_id, full_name, age_years, sex, phone, "self" if primary else "other", primary],
    )
    if created is None:
        raise RuntimeError("patients insert returned no id.")
    return created


def insert_tracking_link(*, booking_id: str, guest_id: str, token_hash: str, expires_at: datetime) -> None:
    """Issues a link and revokes all but the newest four for the booking."""
    db.execute(
        "INSERT INTO guest_links (booking_id, guest_id, token_hash, expires_at) VALUES (%s, %s, %s, %s)",
        [booking_id, guest_id, token_hash, expires_at],
    )
    db.execute(
        """
        UPDATE guest_links
           SET revoked_at = now()
         WHERE booking_id = %s
           AND revoked_at IS NULL
           AND id NOT IN (
             SELECT id FROM guest_links
              WHERE booking_id = %s AND revoked_at IS NULL
              ORDER BY created_at DESC, id DESC
              LIMIT %s
           )
        """,
        [booking_id, booking_id, MAX_LIVE_LINKS_PER_BOOKING],
    )


def has_tracking_link(booking_id: str) -> bool:
    return bool(
        db.fetch_value(
            "SELECT EXISTS (SELECT 1 FROM guest_links WHERE booking_id = %s AND revoked_at IS NULL) AS present",
            [booking_id],
        )
    )


def resolve_tracking_token(token_hash: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT gl.booking_id, gl.guest_id, b.session_id
          FROM guest_links gl
          JOIN bookings b ON b.id = gl.booking_id
         WHERE gl.token_hash = %s
           AND gl.revoked_at IS NULL
           AND gl.expires_at > now()
        """,
        [token_hash],
    )
    if row is None:
        return None
    db.execute("UPDATE guest_links SET last_used_at = now() WHERE token_hash = %s", [token_hash])
    return {"bookingId": row["booking_id"], "guestId": row["guest_id"], "sessionId": row["session_id"]}
