"""Chambers (`sessions`) (port of `repositories/session.repo.ts`)."""

from __future__ import annotations

from typing import Any

from ..core import db

_COLUMNS = """
  s.id, s.hospital_id, s.doctor_id, s.department_id, s.session_date,
  s.planned_start, s.planned_end, s.actual_start, s.actual_end,
  s.status, s.capacity, s.fee_poisha, s.delay_minutes,
  s.avg_consult_seconds, s.last_event_seq, d.default_consult_minutes
"""


def _to_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "hospitalId": row["hospital_id"],
        "doctorId": row["doctor_id"],
        "departmentId": row["department_id"],
        "sessionDate": row["session_date"],
        "plannedStart": row["planned_start"],
        "plannedEnd": row["planned_end"],
        "actualStart": row["actual_start"],
        "actualEnd": row["actual_end"],
        "status": row["status"],
        "capacity": row["capacity"],
        "feePoisha": row["fee_poisha"],
        "delayMinutes": row["delay_minutes"],
        "avgConsultSeconds": row["avg_consult_seconds"],
        "lastEventSeq": int(row["last_event_seq"]),
        "defaultConsultMinutes": row["default_consult_minutes"],
    }


def find_by_id(session_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        f"""
        SELECT {_COLUMNS}
          FROM sessions s
          JOIN doctors d ON d.id = s.doctor_id
         WHERE s.id = %s AND s.deleted_at IS NULL
        """,
        [session_id],
    )
    return None if row is None else _to_row(row)


def lock_for_update(session_id: str) -> dict[str, Any] | None:
    """The session row, held until the transaction ends (FR-QUE-53)."""
    row = db.fetch_one(
        f"""
        SELECT {_COLUMNS}
          FROM sessions s
          JOIN doctors d ON d.id = s.doctor_id
         WHERE s.id = %s AND s.deleted_at IS NULL
           FOR UPDATE OF s
        """,
        [session_id],
    )
    return None if row is None else _to_row(row)


def save_projection(session_id: str, projection: dict[str, Any]) -> None:
    db.execute(
        """
        UPDATE sessions
           SET status = %s::session_status, actual_start = %s, actual_end = %s,
               delay_minutes = %s, avg_consult_seconds = %s, last_event_seq = %s
         WHERE id = %s
        """,
        [
            projection["status"],
            projection["actualStart"],
            projection["actualEnd"],
            projection["delayMinutes"],
            projection["avgConsultSeconds"],
            str(projection["lastEventSeq"]),
            session_id,
        ],
    )


def list_for_hospital_date(hospital_id: str, session_date: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        f"""
        SELECT {_COLUMNS}
          FROM sessions s
          JOIN doctors d ON d.id = s.doctor_id
         WHERE s.hospital_id = %s AND s.session_date = %s AND s.deleted_at IS NULL
         ORDER BY s.planned_start
        """,
        [hospital_id, session_date],
    )
    return [_to_row(r) for r in rows]


def hospital_id_of(session_id: str) -> str | None:
    return db.fetch_value(
        "SELECT hospital_id FROM sessions WHERE id = %s AND deleted_at IS NULL", [session_id]
    )


def hospital_is_live(session_id: str) -> bool:
    value = db.fetch_value(
        """
        SELECT h.is_live FROM sessions s
          JOIN hospitals h ON h.id = s.hospital_id
         WHERE s.id = %s AND h.deleted_at IS NULL
        """,
        [session_id],
    )
    return bool(value)


def touch_consult_rate(session_id: str, avg_consult_seconds: int) -> None:
    db.execute("UPDATE sessions SET avg_consult_seconds = %s WHERE id = %s", [avg_consult_seconds, session_id])


def exists(session_id: str) -> bool:
    return db.fetch_one("SELECT 1 AS present FROM sessions WHERE id = %s", [session_id]) is not None


def set_capacity(session_id: str, capacity: int) -> None:
    db.execute("UPDATE sessions SET capacity = %s WHERE id = %s", [capacity, session_id])


def queue_rules_for(hospital_id: str) -> dict[str, int]:
    row = db.fetch_one(
        """
        SELECT no_show_grace_patients, no_show_grace_minutes, late_reinsert_after, stale_threshold_minutes
          FROM hospital_settings WHERE hospital_id = %s
        """,
        [hospital_id],
    )
    row = row or {}
    return {
        "noShowGracePatients": row.get("no_show_grace_patients") if row.get("no_show_grace_patients") is not None else 2,
        "noShowGraceMinutes": row.get("no_show_grace_minutes") if row.get("no_show_grace_minutes") is not None else 15,
        "lateReinsertAfter": row.get("late_reinsert_after") if row.get("late_reinsert_after") is not None else 3,
        "staleThresholdMinutes": row.get("stale_threshold_minutes")
        if row.get("stale_threshold_minutes") is not None
        else 10,
    }
