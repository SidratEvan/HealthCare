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
