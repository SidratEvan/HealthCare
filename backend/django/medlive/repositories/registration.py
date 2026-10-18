"""Finding and registering a patient at the counter (port of `repositories/registration.repo.ts`; S-B-03)."""

from __future__ import annotations

import json
from typing import Any

from ..core import db


def guest_name_count(guest_id: str, full_name: str) -> int:
    value = db.fetch_value(
        """
        SELECT count(*)::int AS n FROM patients
         WHERE owner_guest_id = %s AND full_name = %s AND deleted_at IS NULL
        """,
        [guest_id, full_name],
    )
    return int(value or 0)


def registered_patient(patient_id: str) -> dict[str, Any]:
    row = db.fetch_one(
        """
        SELECT id, full_name, coalesce(age_years, date_part('year', age(date_of_birth))::int) AS age_years,
               sex::text AS sex, relationship, is_primary
          FROM patients WHERE id = %s AND deleted_at IS NULL
        """,
        [patient_id],
    )
    if row is None:
        raise RuntimeError("Registered patient receipt missing.")
    return {
        "patientId": row["id"],
        "fullName": row["full_name"],
        "ageYears": row["age_years"],
        "sex": row["sex"],
        "relationship": row["relationship"],
        "isPrimary": row["is_primary"],
        "owner": "guest",
    }


def patients_for_phone(phone: str, hospital_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT p.id, p.full_name,
               coalesce(p.age_years, date_part('year', age(p.date_of_birth))::int) AS age_years,
               p.sex::text AS sex, p.relationship, p.is_primary,
               CASE WHEN p.owner_user_id IS NOT NULL THEN 'account'
                    WHEN p.owner_hospital_id IS NOT NULL THEN 'hospital' ELSE 'guest' END AS owner
          FROM patients p
          LEFT JOIN guest_identities g ON g.id = p.owner_guest_id AND g.deleted_at IS NULL
          LEFT JOIN users u ON u.id = p.owner_user_id AND u.deleted_at IS NULL
         WHERE p.deleted_at IS NULL
           AND (g.phone = %(phone)s OR u.phone = %(phone)s OR p.phone = %(phone)s)
           AND (p.owner_hospital_id IS NULL OR p.owner_hospital_id = %(hospital)s)
         ORDER BY p.is_primary DESC, p.full_name
         LIMIT 20
        """,
        {"phone": phone, "hospital": hospital_id},
    )
    return [
        {
            "patientId": r["id"],
            "fullName": r["full_name"],
            "ageYears": r["age_years"],
            "sex": r["sex"],
            "relationship": r["relationship"],
            "isPrimary": r["is_primary"],
            "owner": r["owner"],
        }
        for r in rows
    ]


def record_lookup(
    *, actor_staff_id: str, hospital_id: str, patient_ids: list[str], ip: str | None, user_agent: str | None
) -> None:
    """A counter lookup reads identities, and is audited as a record view."""
    for patient_id in patient_ids:
        db.execute(
            """
            INSERT INTO audit_log (actor_staff_id, hospital_id, action, subject_table, subject_id,
                                   patient_id, ip, user_agent, meta)
            VALUES (%s, %s, 'RECORD_VIEW', 'patients', %s, %s, %s::inet, %s, %s::jsonb)
            """,
            [
                actor_staff_id,
                hospital_id,
                patient_id,
                patient_id,
                ip,
                user_agent,
                json.dumps({"purpose": "registration_lookup"}, separators=(",", ":")),
            ],
        )
