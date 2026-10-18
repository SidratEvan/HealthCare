"""A facility's own setup (port of `repositories/hospitalSettings.repo.ts`)."""

from __future__ import annotations

from ..core import db


def modules_off(hospital_id: str) -> list[str]:
    row = db.fetch_one(
        "SELECT modules_off FROM hospital_settings WHERE hospital_id = %s", [hospital_id]
    )
    if row is None or row["modules_off"] is None:
        return []
    return list(row["modules_off"])


def set_modules_off(hospital_id: str, off: list[str]) -> None:
    db.execute(
        "INSERT INTO hospital_settings (hospital_id) VALUES (%s) ON CONFLICT (hospital_id) DO NOTHING",
        [hospital_id],
    )
    db.execute(
        "UPDATE hospital_settings SET modules_off = %s::text[], updated_at = now() WHERE hospital_id = %s",
        [list(off), hospital_id],
    )


def desk_doctors_for_staff(staff_user_id: str, hospital_id: str) -> set[str] | None:
    """The doctors a receptionist's desks cover, or None when not at a desk (FR-REC-32)."""
    row = db.fetch_one(
        """
        SELECT EXISTS (
                 SELECT 1 FROM reception_desk_staff ds
                   JOIN reception_desks d ON d.id = ds.desk_id AND d.deleted_at IS NULL
                  WHERE ds.staff_user_id = %s::uuid AND ds.hospital_id = %s::uuid
               ) AS assigned,
               coalesce((
                 SELECT array_agg(DISTINCT dd.doctor_id::text)
                   FROM reception_desk_staff ds
                   JOIN reception_desks d ON d.id = ds.desk_id AND d.deleted_at IS NULL
                   JOIN reception_desk_doctors dd ON dd.desk_id = d.id
                  WHERE ds.staff_user_id = %s::uuid AND ds.hospital_id = %s::uuid
               ), '{}') AS doctor_ids
        """,
        [staff_user_id, hospital_id, staff_user_id, hospital_id],
    )
    if row is None or not row["assigned"]:
        return None
    return set(row["doctor_ids"] or [])
