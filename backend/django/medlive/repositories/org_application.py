"""A facility applying from the public form (port of `repositories/orgApplication.repo.ts`; FR-ONB-*)."""

from __future__ import annotations

from typing import Any

from ..core import db


def find_by_key(key: str) -> dict[str, str] | None:
    row = db.fetch_one(
        """
        SELECT h.id, h.code, u.email
          FROM hospitals h
          JOIN staff_users u ON u.hospital_id = h.id
          JOIN staff_roles r ON r.staff_user_id = u.id AND r.hospital_id = h.id
         WHERE h.application_key = %s AND h.deleted_at IS NULL
           AND r.role = 'hospital_admin' AND r.deleted_at IS NULL
         ORDER BY u.created_at
         LIMIT 1
        """,
        [key],
    )
    return None if row is None else {"hospitalId": row["id"], "code": row["code"], "adminEmail": row["email"]}


def codes_from(stem: str) -> set[str]:
    rows = db.fetch_all(
        """
        SELECT code FROM hospitals
         WHERE deleted_at IS NULL AND code IS NOT NULL
           AND (code = %s OR code LIKE %s)
        """,
        [stem, f"{stem}-%"],
    )
    return {r["code"] for r in rows}


def open_applications() -> int:
    value = db.fetch_value(
        """
        SELECT count(*)::text AS n FROM hospitals
         WHERE self_registered AND lifecycle = 'setup' AND deleted_at IS NULL
        """
    )
    return int(value or "0")


def create_workspace(
    *,
    code: str,
    key: str,
    name_bn: str,
    name_en: str,
    kind: str,
    division: str,
    district: str,
    phone: str,
    registration_no: str,
) -> str:
    hospital_id: Any = db.fetch_value(
        """
        INSERT INTO hospitals (code, name_bn, name_en, kind, division, district, phone,
                               registration_no, is_live, self_registered, application_key)
        VALUES (%s, %s, %s, %s::facility_kind, %s, %s, %s, %s, false, true, %s)
        RETURNING id
        """,
        [code, name_bn, name_en, kind, division, district, phone, registration_no, key],
    )
    if hospital_id is None:
        raise RuntimeError("hospitals returned no id")
    db.execute("INSERT INTO hospital_settings (hospital_id) VALUES (%s)", [hospital_id])
    return hospital_id


def create_applicant(*, hospital_id: str, email: str, full_name: str, phone: str, password_hash: str) -> str:
    staff_id = db.fetch_value(
        """
        INSERT INTO staff_users (hospital_id, email, full_name, phone, password_hash,
                                 must_change_password, password_changed_at)
        VALUES (%s, %s, %s, %s, %s, false, now())
        RETURNING id
        """,
        [hospital_id, email, full_name, phone, password_hash],
    )
    if staff_id is None:
        raise RuntimeError("staff_users returned no id")
    return staff_id
