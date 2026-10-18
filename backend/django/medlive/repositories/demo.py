"""What the password-less demonstration picker offers (port of `repositories/demo.repo.ts`; CLAUDE.md §4.1)."""

from __future__ import annotations

from typing import Any

from ..core import db
from .chamber import todays_chambers
from .hospital_settings import list_desks

FACILITY_ROLES = {"ward", "emergency", "lab", "pharmacy", "hospital_admin"}


def list_consoles() -> list[dict[str, Any]]:
    hospitals = db.fetch_all(
        """
        SELECT h.id AS hospital_id, h.name_bn, h.name_en, h.district,
               array_agg(DISTINCT sr.role::text) AS roles
          FROM hospitals h
          JOIN staff_users su ON su.hospital_id = h.id AND su.deleted_at IS NULL
          JOIN staff_roles sr ON sr.staff_user_id = su.id AND sr.deleted_at IS NULL
         WHERE h.is_live AND h.deleted_at IS NULL
         GROUP BY h.id, h.name_bn, h.name_en, h.district
         ORDER BY h.name_en
        """
    )
    sessions = todays_chambers(None)
    desks_of = {row["hospital_id"]: list_desks(row["hospital_id"]) for row in hospitals}
    by_hospital: dict[str, list[dict[str, Any]]] = {}
    for session in sessions:
        rest = {k: v for k, v in session.items() if k != "hospitalId"}
        by_hospital.setdefault(session["hospitalId"], []).append(rest)
    consoles = [
        {
            "hospitalId": row["hospital_id"],
            "nameBn": row["name_bn"],
            "nameEn": row["name_en"],
            "district": row["district"],
            "roles": sorted(row["roles"]),
            "sessions": by_hospital.get(row["hospital_id"], []),
            "desks": desks_of.get(row["hospital_id"], []),
        }
        for row in hospitals
    ]
    shown = [
        hospital
        for hospital in consoles
        if hospital["sessions"] or any(role in FACILITY_ROLES for role in hospital["roles"])
    ]
    return sorted(shown, key=lambda h: -_running_first(h))


def _running_first(hospital: dict[str, Any]) -> int:
    return 1 if any(session["status"] == "running" for session in hospital["sessions"]) else 0


def national_roles() -> list[str]:
    rows = db.fetch_all(
        """
        SELECT DISTINCT sr.role::text AS role
          FROM staff_roles sr
          JOIN staff_users su ON su.id = sr.staff_user_id
         WHERE sr.hospital_id IS NULL AND su.hospital_id IS NULL
           AND sr.deleted_at IS NULL AND su.deleted_at IS NULL
         ORDER BY 1
        """
    )
    return [r["role"] for r in rows]


def national_staff_for(role: str) -> dict[str, str] | None:
    row = db.fetch_one(
        """
        SELECT su.id, su.full_name
          FROM staff_users su
          JOIN staff_roles sr ON sr.staff_user_id = su.id
         WHERE su.hospital_id IS NULL
           AND sr.hospital_id IS NULL
           AND sr.role = %s::staff_role
           AND sr.deleted_at IS NULL
           AND su.deleted_at IS NULL
         ORDER BY (sr.scope @> '{"demo": true}'::jsonb) DESC, su.full_name
         LIMIT 1
        """,
        [role],
    )
    return None if row is None else {"id": row["id"], "fullName": row["full_name"]}


def staff_for(hospital_id: str, role: str) -> dict[str, str] | None:
    row = db.fetch_one(
        """
        SELECT su.id, su.full_name
          FROM staff_users su
          JOIN staff_roles sr ON sr.staff_user_id = su.id
         WHERE su.hospital_id = %s::uuid
           AND sr.role = %s::staff_role
           AND sr.deleted_at IS NULL
           AND su.deleted_at IS NULL
         ORDER BY (sr.scope @> '{"demo": true}'::jsonb) DESC, su.full_name
         LIMIT 1
        """,
        [hospital_id, role],
    )
    return None if row is None else {"id": row["id"], "fullName": row["full_name"]}
