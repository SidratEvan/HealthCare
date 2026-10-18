"""Patients' one-time codes, accounts, sessions and claiming (port of `repositories/patientAuth.repo.ts`;
FR-PAT-01, FR-PAT-04, FR-GST-03, FR-GST-09, FR-SEC-05)."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from ..core import db


def sent_in_last_hour(phone: str) -> int:
    value = db.fetch_value(
        "SELECT count(*)::int AS n FROM otp_challenges WHERE phone = %s AND created_at > now() - interval '1 hour'",
        [phone],
    )
    return int(value or 0)


def locked_until(phone: str) -> datetime | None:
    return db.fetch_value(
        "SELECT max(locked_until) AS locked_until FROM otp_challenges WHERE phone = %s AND locked_until > now()",
        [phone],
    )


def create_challenge(*, phone: str, code_hash: str, expires_at: datetime, ip: str | None) -> str:
    db.execute("UPDATE otp_challenges SET consumed_at = now() WHERE phone = %s AND consumed_at IS NULL", [phone])
    challenge_id = db.fetch_value(
        """
        INSERT INTO otp_challenges (phone, code_hash, expires_at, ip)
        VALUES (%s, %s, %s, %s::inet)
        RETURNING id
        """,
        [phone, code_hash, expires_at, ip],
    )
    if challenge_id is None:
        raise RuntimeError("otp_challenges returned no id")
    return challenge_id


def open_challenge(phone: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT id, code_hash, attempts, expires_at FROM otp_challenges
         WHERE phone = %s AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1
        """,
        [phone],
    )
    if row is None:
        return None
    return {"id": row["id"], "codeHash": row["code_hash"], "attempts": row["attempts"], "expiresAt": row["expires_at"]}


def record_wrong_code(challenge_id: str, max_attempts: int, lock_minutes: int) -> dict[str, Any]:
    row = db.fetch_one(
        """
        UPDATE otp_challenges SET
          attempts = attempts + 1,
          locked_until = CASE WHEN attempts + 1 >= %(max)s
                              THEN now() + make_interval(mins => %(minutes)s) ELSE locked_until END,
          consumed_at = CASE WHEN attempts + 1 >= %(max)s THEN now() ELSE consumed_at END
         WHERE id = %(id)s
        RETURNING attempts, locked_until
        """,
        {"max": max_attempts, "minutes": lock_minutes, "id": challenge_id},
    )
    if row is None:
        return {"attempts": max_attempts, "lockedUntil": None}
    return {"attempts": row["attempts"], "lockedUntil": row["locked_until"]}


def consume(challenge_id: str) -> bool:
    return (
        db.execute(
            "UPDATE otp_challenges SET consumed_at = now() WHERE id = %s AND consumed_at IS NULL", [challenge_id]
        )
        == 1
    )


def sign_in_user(phone: str) -> dict[str, Any]:
    found = db.fetch_value(
        """
        UPDATE users SET phone_verified_at = now(), last_login_at = now()
         WHERE phone = %s AND deleted_at IS NULL
        RETURNING id
        """,
        [phone],
    )
    if found is not None:
        return {"id": found, "isNew": False}
    created = db.fetch_value(
        """
        INSERT INTO users (phone, kind, phone_verified_at, last_login_at)
        VALUES (%s, 'patient', now(), now())
        ON CONFLICT (phone) WHERE deleted_at IS NULL DO UPDATE SET last_login_at = now()
        RETURNING id
        """,
        [phone],
    )
    if created is None:
        raise RuntimeError("users returned no id")
    return {"id": created, "isNew": True}


def user_by_id(user_id: str) -> dict[str, str] | None:
    row = db.fetch_one("SELECT id, phone FROM users WHERE id = %s AND deleted_at IS NULL", [user_id])
    return None if row is None else {"id": row["id"], "phone": row["phone"]}


def create_session(*, user_id: str, token_hash: str, expires_at: datetime, ip: str | None, device: str | None) -> str:
    session_id = db.fetch_value(
        """
        INSERT INTO sessions_auth (subject_id, subject_kind, token_hash, device_fingerprint, ip, expires_at)
        VALUES (%s, 'user', %s, %s, %s::inet, %s)
        RETURNING id
        """,
        [user_id, token_hash, device, ip, expires_at],
    )
    if session_id is None:
        raise RuntimeError("sessions_auth returned no id")
    return session_id


def find_session(session_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT id, subject_id, token_hash, device_fingerprint, expires_at, revoked_at
          FROM sessions_auth WHERE id = %s AND subject_kind = 'user'
        """,
        [session_id],
    )
    if row is None:
        return None
    return {
        "id": row["id"],
        "userId": row["subject_id"],
        "tokenHash": row["token_hash"],
        "device": row["device_fingerprint"],
        "expiresAt": row["expires_at"],
        "revokedAt": row["revoked_at"],
    }


def revoke_session(session_id: str) -> bool:
    return (
        db.execute(
            "UPDATE sessions_auth SET revoked_at = now(), updated_at = now() WHERE id = %s AND revoked_at IS NULL",
            [session_id],
        )
        == 1
    )


def revoke_all_sessions(user_id: str) -> None:
    db.execute(
        """
        UPDATE sessions_auth SET revoked_at = now(), updated_at = now()
         WHERE subject_kind = 'user' AND subject_id = %s AND revoked_at IS NULL
        """,
        [user_id],
    )


_PROFILE_COLUMNS = """
  p.id AS patient_id, p.full_name,
  coalesce(p.age_years, date_part('year', age(p.date_of_birth))::int) AS age_years,
  p.sex::text AS sex, p.relationship, p.is_primary,
  (SELECT count(*)::int FROM bookings b WHERE b.patient_id = p.id AND b.deleted_at IS NULL) AS bookings,
  (SELECT count(*)::int FROM visits v WHERE v.patient_id = p.id) AS visits
"""


def _to_profile(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "patientId": r["patient_id"],
        "fullName": r["full_name"],
        "ageYears": r["age_years"],
        "sex": r["sex"],
        "relationship": r["relationship"],
        "isPrimary": r["is_primary"],
        "bookings": r["bookings"],
        "visits": r["visits"],
    }


def profiles_of(user_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        f"""
        SELECT {_PROFILE_COLUMNS} FROM patients p
         WHERE p.owner_user_id = %s AND p.deleted_at IS NULL
         ORDER BY p.is_primary DESC, p.full_name
        """,
        [user_id],
    )
    return [_to_profile(r) for r in rows]


def claimable_for(phone: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        f"""
        SELECT {_PROFILE_COLUMNS}, h.name_bn AS hospital_name_bn, h.name_en AS hospital_name_en
          FROM patients p
          LEFT JOIN guest_identities g ON g.id = p.owner_guest_id
          LEFT JOIN hospitals h ON h.id = p.owner_hospital_id
         WHERE p.deleted_at IS NULL
           AND ((g.phone = %(phone)s AND g.claimed_by_user_id IS NULL AND g.deleted_at IS NULL)
                OR (p.owner_hospital_id IS NOT NULL AND p.phone = %(phone)s))
         ORDER BY p.full_name
        """,
        {"phone": phone},
    )
    return [{**_to_profile(r), "hospitalNameBn": r["hospital_name_bn"], "hospitalNameEn": r["hospital_name_en"]} for r in rows]


def claim(*, user_id: str, phone: str) -> int:
    """Moves every guest and hospital record made under a phone to the account that proved it."""
    has_primary = bool(
        db.fetch_value(
            "SELECT EXISTS (SELECT 1 FROM patients WHERE owner_user_id = %s AND is_primary AND deleted_at IS NULL) AS has",
            [user_id],
        )
    )
    guests = db.fetch_all(
        """
        UPDATE guest_identities SET claimed_by_user_id = %s, claimed_at = now()
         WHERE phone = %s AND claimed_by_user_id IS NULL AND deleted_at IS NULL
        RETURNING id
        """,
        [user_id, phone],
    )
    guest_ids = [r["id"] for r in guests]
    from_guest = db.execute(
        """
        UPDATE patients SET owner_user_id = %s, owner_guest_id = NULL,
               is_primary = is_primary AND NOT %s, updated_at = now()
         WHERE owner_guest_id = ANY(%s::uuid[]) AND deleted_at IS NULL
        """,
        [user_id, has_primary, guest_ids],
    )
    from_hospital = db.execute(
        """
        UPDATE patients SET owner_user_id = %s, owner_hospital_id = NULL, is_primary = false,
               updated_at = now()
         WHERE owner_hospital_id IS NOT NULL AND phone = %s AND deleted_at IS NULL
        """,
        [user_id, phone],
    )
    return from_guest + from_hospital


def audit_claim(*, user_id: str, moved: int) -> None:
    db.execute(
        """
        INSERT INTO audit_log (actor_user_id, action, subject_table, subject_id, meta)
        VALUES (%s, 'SETTINGS_CHANGE', 'users', %s, %s::jsonb)
        """,
        [user_id, user_id, json.dumps({"change": "claimed_records", "moved": moved}, separators=(",", ":"))],
    )


def verified_guest(phone: str) -> str | None:
    return db.fetch_value(
        "SELECT id FROM guest_identities WHERE phone = %s AND phone_verified_at IS NOT NULL AND deleted_at IS NULL",
        [phone],
    )


def mark_guest_verified(phone: str, display_name: str) -> str:
    guest_id = db.fetch_value(
        """
        INSERT INTO guest_identities (phone, display_name, phone_verified_at)
        VALUES (%s, %s, now())
        ON CONFLICT (phone) WHERE deleted_at IS NULL
          DO UPDATE SET phone_verified_at = now()
        RETURNING id
        """,
        [phone, display_name],
    )
    if guest_id is None:
        raise RuntimeError("guest_identities returned no id")
    return guest_id
