"""Today's chambers, as a console lists them (port of `repositories/chamber.repo.ts`)."""

from __future__ import annotations

from typing import Any

from ..core import db
from ..domain.time import from_datetime


def todays_chambers(hospital_id: str | None, include_ended: bool = False) -> list[dict[str, Any]]:
    """Today's, plus a running or paused chamber from yesterday still going (FR-QUE-06)."""
    rows = db.fetch_all(
        """
        SELECT s.hospital_id, s.id,
               s.doctor_id,
               d.full_name_bn AS doctor_name_bn,
               d.full_name_en AS doctor_name_en,
               dep.name_bn    AS department_name_bn,
               dep.name_en    AS department_name_en,
               s.room, s.status::text AS status, s.planned_start, s.planned_end,
               to_char(s.session_date, 'YYYY-MM-DD') AS session_date,
               (s.session_date = (now() AT TIME ZONE 'Asia/Dhaka')::date) AS today,
               c.waiting::text AS waiting,
               c.total::text AS total
          FROM sessions s
          JOIN doctors d       ON d.id = s.doctor_id
          JOIN departments dep ON dep.id = s.department_id
          CROSS JOIN LATERAL fn_chamber_counts(s.id) c
         WHERE s.deleted_at IS NULL
           AND (%(hospital)s::uuid IS NULL OR s.hospital_id = %(hospital)s::uuid)
           AND s.room IS DISTINCT FROM 'E2E'
           AND (%(include_ended)s::boolean OR s.status <> 'ended')
           AND (
             s.session_date = (now() AT TIME ZONE 'Asia/Dhaka')::date
             OR (s.status IN ('running', 'paused')
                 AND s.session_date >= (now() AT TIME ZONE 'Asia/Dhaka')::date - 1)
           )
         ORDER BY
           CASE s.status WHEN 'running' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END,
           s.planned_start
        """,
        {"hospital": hospital_id, "include_ended": include_ended},
    )
    return [
        {
            "hospitalId": r["hospital_id"],
            "id": r["id"],
            "doctorId": r["doctor_id"],
            "doctorNameBn": r["doctor_name_bn"],
            "doctorNameEn": r["doctor_name_en"],
            "departmentNameBn": r["department_name_bn"],
            "departmentNameEn": r["department_name_en"],
            "room": r["room"],
            "status": r["status"],
            "sessionDate": r["session_date"],
            "today": r["today"],
            "plannedStart": from_datetime(r["planned_start"]),
            "plannedEnd": from_datetime(r["planned_end"]),
            "waiting": int(r["waiting"]),
            "total": int(r["total"]),
        }
        for r in rows
    ]
