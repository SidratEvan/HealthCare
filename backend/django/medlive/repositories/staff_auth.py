"""Staff accounts, roles, sign-in sessions and the second factor
(port of `repositories/staffAuth.repo.ts`; FR-SEC-06, FR-SEC-10, pilot steps 21 and 28)."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from ..core import db

_ACCOUNT_COLUMNS = """
  su.id, su.hospital_id, su.email, su.full_name, su.password_hash, su.is_active,
  su.must_change_password, su.failed_login_count, su.locked_until,
  h.code AS hospital_code, h.name_bn AS hospital_name_bn, h.name_en AS hospital_name_en,
  su.totp_secret, su.totp_enabled_at, su.totp_last_step,
  cardinality(su.totp_recovery_hashes)::int AS recovery_left
"""


def _to_account(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r["id"],
        "hospitalId": r["hospital_id"],
        "email": r["email"],
        "fullName": r["full_name"],
        "passwordHash": r["password_hash"],
        "isActive": r["is_active"],
        "mustChangePassword": r["must_change_password"],
        "failedLoginCount": r["failed_login_count"],
        "lockedUntil": r["locked_until"],
        "hospitalCode": r["hospital_code"],
        "hospitalNameBn": r["hospital_name_bn"],
        "hospitalNameEn": r["hospital_name_en"],
        "totpSecret": r["totp_secret"],
        "totpEnabled": r["totp_enabled_at"] is not None,
        "totpLastStep": None if r["totp_last_step"] is None else int(r["totp_last_step"]),
        "recoveryCodesLeft": r["recovery_left"],
    }


def find_by_email(email: str, hospital_code: str | None) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        f"""
        SELECT {_ACCOUNT_COLUMNS}
          FROM staff_users su
          LEFT JOIN hospitals h ON h.id = su.hospital_id AND h.deleted_at IS NULL
         WHERE lower(su.email) = lower(%(email)s)
           AND su.deleted_at IS NULL
           AND (%(code)s::text IS NULL OR h.code = upper(%(code)s::text))
         ORDER BY su.created_at
        """,
        {"email": email, "code": hospital_code},
    )
    return [_to_account(r) for r in rows]


def find_by_id(staff_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        f"""
        SELECT {_ACCOUNT_COLUMNS}
          FROM staff_users su
          LEFT JOIN hospitals h ON h.id = su.hospital_id AND h.deleted_at IS NULL
         WHERE su.id = %s AND su.deleted_at IS NULL
        """,
        [staff_id],
    )
    return None if row is None else _to_account(row)


def roles_of(staff_id: str, hospital_id: str | None) -> list[str]:
    rows = db.fetch_all(
        """
        SELECT DISTINCT role::text AS role
          FROM staff_roles
         WHERE staff_user_id = %s
           AND hospital_id IS NOT DISTINCT FROM %s::uuid
           AND deleted_at IS NULL
         ORDER BY role
        """,
        [staff_id, hospital_id],
    )
    return [r["role"] for r in rows]


def record_failure(staff_id: str, attempts: int, lock_minutes: int) -> datetime | None:
    row = db.fetch_one(
        """
        UPDATE staff_users
           SET failed_login_count = CASE WHEN failed_login_count + 1 >= %(attempts)s
                                         THEN 0 ELSE failed_login_count + 1 END,
               locked_until       = CASE WHEN failed_login_count + 1 >= %(attempts)s
                                         THEN now() + make_interval(mins => %(minutes)s)
                                         ELSE locked_until END,
               updated_at         = now()
         WHERE id = %(id)s
         RETURNING locked_until
        """,
        {"attempts": attempts, "minutes": lock_minutes, "id": staff_id},
    )
    return None if row is None else row["locked_until"]


def record_success(staff_id: str) -> None:
    db.execute(
        """
        UPDATE staff_users
           SET failed_login_count = 0, locked_until = NULL, last_login_at = now(), updated_at = now()
         WHERE id = %s
        """,
        [staff_id],
    )


def set_password(staff_id: str, password_hash: str, must_change: bool) -> None:
    db.execute(
        """
        UPDATE staff_users
           SET password_hash = %s, must_change_password = %s,
               password_changed_at = now(), failed_login_count = 0, locked_until = NULL,
               updated_at = now()
         WHERE id = %s
        """,
        [password_hash, must_change, staff_id],
    )


def upgrade_hash(staff_id: str, password_hash: str) -> None:
    db.execute("UPDATE staff_users SET password_hash = %s, updated_at = now() WHERE id = %s", [password_hash, staff_id])


def pending_totp(staff_id: str, proposed: str, replace: bool = False) -> str | None:
    return db.fetch_value(
        """
        UPDATE staff_users
           SET totp_secret = CASE WHEN %(replace)s THEN %(proposed)s
                                  ELSE COALESCE(totp_secret, %(proposed)s) END,
               totp_last_step = NULL, totp_recovery_hashes = '{}', updated_at = now()
         WHERE id = %(id)s AND totp_enabled_at IS NULL AND deleted_at IS NULL
         RETURNING totp_secret
        """,
        {"replace": replace, "proposed": proposed, "id": staff_id},
    )


def enable_totp(*, staff_id: str, step: int, recovery_hashes: list[str]) -> bool:
    return (
        db.execute(
            """
            UPDATE staff_users
               SET totp_enabled_at = now(), totp_last_step = %s,
                   totp_recovery_hashes = %s::text[], updated_at = now()
             WHERE id = %s AND totp_enabled_at IS NULL AND totp_secret IS NOT NULL
            """,
            [step, list(recovery_hashes), staff_id],
        )
        == 1
    )


def accept_totp_step(staff_id: str, step: int) -> bool:
    """Accepts a code's time step once only: a replayed code is refused."""
    return (
        db.execute(
            """
            UPDATE staff_users SET totp_last_step = %(step)s, updated_at = now()
             WHERE id = %(id)s AND totp_enabled_at IS NOT NULL
               AND (totp_last_step IS NULL OR totp_last_step < %(step)s)
            """,
            {"step": step, "id": staff_id},
        )
        == 1
    )


def use_recovery_code(staff_id: str, code_hash: str) -> bool:
    return (
        db.execute(
            """
            UPDATE staff_users
               SET totp_recovery_hashes = array_remove(totp_recovery_hashes, %(hash)s), updated_at = now()
             WHERE id = %(id)s AND totp_enabled_at IS NOT NULL AND %(hash)s = ANY(totp_recovery_hashes)
            """,
            {"hash": code_hash, "id": staff_id},
        )
        == 1
    )


def clear_two_factor(staff_id: str) -> bool:
    return (
        db.execute(
            """
            UPDATE staff_users
               SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL,
                   totp_recovery_hashes = '{}', updated_at = now()
             WHERE id = %s AND deleted_at IS NULL
            """,
            [staff_id],
        )
        == 1
    )


def record_security_change(
    *,
    actor_staff_id: str | None,
    hospital_id: str | None,
    staff_id: str,
    change: str,
    ip: str | None,
    user_agent: str | None,
) -> None:
    db.execute(
        """
        INSERT INTO audit_log (actor_staff_id, hospital_id, action, subject_table, subject_id, ip, user_agent, meta)
        VALUES (%s, %s, 'SETTINGS_CHANGE', 'staff_users', %s, %s::inet, %s, %s::jsonb)
        """,
        [actor_staff_id, hospital_id, staff_id, ip, user_agent, json.dumps({"change": change}, separators=(",", ":"))],
    )


def create_refresh_session(
    *, staff_id: str, token_hash: str, expires_at: datetime, ip: str | None, user_agent: str | None, family_id: str
) -> str:
    session_id = db.fetch_value(
        """
        INSERT INTO sessions_auth
          (subject_id, subject_kind, token_hash, device_fingerprint, ip, expires_at, family_id)
        VALUES (%s, 'staff', %s, %s, %s::inet, %s, %s::uuid)
        RETURNING id
        """,
        [staff_id, token_hash, user_agent, ip, expires_at, family_id],
    )
    if session_id is None:
        raise RuntimeError("sessions_auth returned no id")
    return session_id


def find_refresh_session(session_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT id, subject_id, token_hash, expires_at, revoked_at, family_id
          FROM sessions_auth WHERE id = %s AND subject_kind = 'staff'
        """,
        [session_id],
    )
    if row is None:
        return None
    return {
        "id": row["id"],
        "subjectId": row["subject_id"],
        "tokenHash": row["token_hash"],
        "expiresAt": row["expires_at"],
        "revokedAt": row["revoked_at"],
        "familyId": row["family_id"] if row["family_id"] is not None else row["id"],
    }


def access_state(staff_id: str, family_id: str | None) -> dict[str, Any] | None:
    """Whether the account, and the sign-in a token names, still stand (`FR-SEC-06`)."""
    row = db.fetch_one(
        """
        SELECT (su.is_active AND su.deleted_at IS NULL) AS account_live,
               EXISTS (
                 SELECT 1 FROM sessions_auth sa
                  WHERE sa.family_id = %s::uuid
                    AND sa.subject_kind = 'staff'
                    AND sa.subject_id = su.id
                    AND sa.revoked_at IS NULL
                    AND sa.expires_at > now()
               ) AS family_live
          FROM staff_users su
         WHERE su.id = %s::uuid
        """,
        [family_id, staff_id],
    )
    if row is None:
        return None
    return {"accountLive": bool(row["account_live"]), "familyLive": bool(row["family_live"])}


def revoke_refresh_session(session_id: str) -> bool:
    """Revokes one session if still open; only one of two racing refreshes wins."""
    return (
        db.execute(
            "UPDATE sessions_auth SET revoked_at = now(), updated_at = now() WHERE id = %s AND revoked_at IS NULL",
            [session_id],
        )
        == 1
    )


def revoke_other_sessions(staff_id: str, keep: str | None) -> None:
    db.execute(
        """
        UPDATE sessions_auth SET revoked_at = now(), updated_at = now()
         WHERE subject_kind = 'staff' AND subject_id = %(staff)s AND revoked_at IS NULL
           AND (%(keep)s::uuid IS NULL OR id <> %(keep)s::uuid)
        """,
        {"staff": staff_id, "keep": keep},
    )


def hospital_id_by_code(code: str) -> str | None:
    return db.fetch_value("SELECT id FROM hospitals WHERE code = %s AND deleted_at IS NULL", [code])


def create_hospital(*, code: str, name_bn: str, name_en: str, kind: str, division: str, district: str) -> str:
    hospital_id = db.fetch_value(
        """
        INSERT INTO hospitals (code, name_bn, name_en, kind, division, district, is_live)
        VALUES (%s, %s, %s, %s::facility_kind, %s, %s, false)
        RETURNING id
        """,
        [code, name_bn, name_en, kind, division, district],
    )
    if hospital_id is None:
        raise RuntimeError("hospitals returned no id")
    db.execute("INSERT INTO hospital_settings (hospital_id) VALUES (%s)", [hospital_id])
    return hospital_id


def email_taken_at(hospital_id: str, email: str) -> bool:
    return (
        db.fetch_one(
            "SELECT 1 AS one FROM staff_users WHERE hospital_id = %s AND lower(email) = lower(%s) AND deleted_at IS NULL",
            [hospital_id, email],
        )
        is not None
    )


def national_email_taken(email: str) -> bool:
    return (
        db.fetch_one(
            "SELECT 1 AS one FROM staff_users WHERE hospital_id IS NULL AND lower(email) = lower(%s) AND deleted_at IS NULL",
            [email],
        )
        is not None
    )


def create_staff_account(
    *,
    hospital_id: str | None,
    email: str,
    full_name: str,
    staff_code: str | None,
    password_hash: str,
    created_by: str | None,
) -> str:
    staff_id = db.fetch_value(
        """
        INSERT INTO staff_users (hospital_id, email, staff_code, full_name, password_hash,
                                 must_change_password, password_changed_at, created_by)
        VALUES (%s, %s, %s, %s, %s, true, now(), %s)
        RETURNING id
        """,
        [hospital_id, email.strip(), staff_code, full_name, password_hash, created_by],
    )
    if staff_id is None:
        raise RuntimeError("staff_users returned no id")
    return staff_id


def grant_role(*, staff_id: str, hospital_id: str | None, role: str) -> None:
    db.execute(
        """
        INSERT INTO staff_roles (staff_user_id, hospital_id, role)
        VALUES (%s, %s, %s::staff_role)
        ON CONFLICT DO NOTHING
        """,
        [staff_id, hospital_id, role],
    )
