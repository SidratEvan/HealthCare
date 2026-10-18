"""Each day's chambers written from the schedules (port of `repositories/sessionMaterialise.repo.ts`; FR-ADM-11)."""

from __future__ import annotations

from typing import Any

from ..core import db


def active_schedules(start: str, only_template: str | None = None) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT t.id, t.weekday, to_char(t.start_time, 'HH24:MI') AS start_time,
               to_char(t.end_time, 'HH24:MI') AS end_time,
               to_char(t.active_from, 'YYYY-MM-DD') AS active_from,
               to_char(t.active_to, 'YYYY-MM-DD') AS active_to,
               t.capacity, dh.hospital_id, dh.doctor_id, dh.department_id, dh.room, dh.fee_poisha
          FROM session_templates t
          JOIN doctor_hospitals dh ON dh.id = t.doctor_hospital_id
          JOIN doctors d ON d.id = dh.doctor_id
          JOIN hospitals h ON h.id = dh.hospital_id
          JOIN departments dep ON dep.id = dh.department_id
         WHERE t.deleted_at IS NULL AND dh.deleted_at IS NULL AND dh.is_active
           AND d.deleted_at IS NULL AND h.deleted_at IS NULL AND dep.deleted_at IS NULL
           AND (t.active_to IS NULL OR t.active_to >= %(from)s::date)
           AND (%(only)s::uuid IS NULL OR t.id = %(only)s::uuid)
        """,
        {"from": start, "only": only_template},
    )
    return [
        {
            "id": r["id"],
            "weekday": r["weekday"],
            "startTime": r["start_time"],
            "endTime": r["end_time"],
            "activeFrom": r["active_from"],
            "activeTo": r["active_to"],
            "capacity": r["capacity"],
            "hospitalId": r["hospital_id"],
            "doctorId": r["doctor_id"],
            "departmentId": r["department_id"],
            "room": r["room"],
            "feePoisha": r["fee_poisha"],
        }
        for r in rows
    ]


def insert_missing(rows: list[dict[str, Any]]) -> int:
    written = 0
    for start in range(0, len(rows), 200):
        batch = rows[start : start + 200]
        values = ", ".join(
            "(%s::uuid, %s::uuid, %s::uuid, %s::uuid, %s, %s::date, %s::timestamptz, %s::timestamptz, %s::int, %s::int)"
            for _ in batch
        )
        params: list[Any] = []
        for row in batch:
            params += [
                row["templateId"],
                row["hospitalId"],
                row["doctorId"],
                row["departmentId"],
                row["room"],
                row["sessionDate"],
                row["plannedStart"],
                row["plannedEnd"],
                row["capacity"],
                row["feePoisha"],
            ]
        result = db.fetch_all(
            f"""
            INSERT INTO sessions (template_id, hospital_id, doctor_id, department_id, room, session_date,
                                  planned_start, planned_end, capacity, fee_poisha)
            VALUES {values}
            ON CONFLICT (template_id, session_date) WHERE template_id IS NOT NULL AND deleted_at IS NULL
            DO NOTHING
            RETURNING id
            """,
            params,
        )
        written += len(result)
    return written
