"""The day's chambers on the administrator's overview (port of `repositories/adminChambers.repo.ts`)."""

from __future__ import annotations

from typing import Any

from ..core import db
from ..domain.time import from_datetime

CHAMBER_LIMIT = 250


def chambers_today(hospital_id: str, date: str) -> dict[str, Any]:
    rows = db.fetch_all(
        """
        WITH selected AS MATERIALIZED (
          SELECT s.id, s.doctor_id, s.department_id, s.room, s.status,
                 s.planned_start, s.planned_end, s.actual_start, s.delay_minutes
            FROM sessions s
           WHERE s.hospital_id = %(h)s::uuid
             AND s.session_date = %(date)s::date AND s.deleted_at IS NULL
           ORDER BY s.planned_start, s.id
           LIMIT %(limit)s
        ), counts AS (
          SELECT b.session_id,
                 count(*) FILTER (WHERE b.status IN ('booked', 'waiting'))::int AS waiting,
                 count(*) FILTER (WHERE b.status = 'done')::int AS seen,
                 count(*) FILTER (WHERE b.status = 'no_show')::int AS no_shows
            FROM bookings b JOIN selected s ON s.id = b.session_id
           WHERE b.deleted_at IS NULL
           GROUP BY b.session_id
        ), desks AS (
          SELECT dd.doctor_id,
                 jsonb_agg(jsonb_build_object('id', d.id, 'nameBn', d.name_bn, 'nameEn', d.name_en)
                           ORDER BY d.name_en, d.id) AS desks
            FROM reception_desk_doctors dd
            JOIN reception_desks d ON d.id = dd.desk_id
           WHERE dd.hospital_id = %(h)s::uuid AND d.hospital_id = %(h)s::uuid
             AND d.deleted_at IS NULL
             AND dd.doctor_id IN (SELECT doctor_id FROM selected)
           GROUP BY dd.doctor_id
        )
        SELECT s.id AS session_id, d.full_name_bn AS doctor_name_bn,
               d.full_name_en AS doctor_name_en, dep.name_bn AS department_name_bn,
               dep.name_en AS department_name_en, s.room, s.status::text AS status,
               s.planned_start, s.planned_end, s.actual_start,
               s.delay_minutes AS declared_delay_minutes,
               coalesce(c.waiting, 0)::int AS waiting, coalesce(c.seen, 0)::int AS seen,
               coalesce(c.no_shows, 0)::int AS no_shows, coalesce(desks.desks, '[]'::jsonb) AS desks
          FROM selected s
          JOIN doctors d ON d.id = s.doctor_id
          JOIN departments dep ON dep.id = s.department_id AND dep.hospital_id = %(h)s::uuid
          LEFT JOIN counts c ON c.session_id = s.id
          LEFT JOIN desks ON desks.doctor_id = s.doctor_id
         ORDER BY s.planned_start, s.id
        """,
        {"h": hospital_id, "date": date, "limit": CHAMBER_LIMIT + 1},
    )
    return {
        "chambersTruncated": len(rows) > CHAMBER_LIMIT,
        "chambers": [
            {
                "sessionId": r["session_id"],
                "doctorNameBn": r["doctor_name_bn"],
                "doctorNameEn": r["doctor_name_en"],
                "departmentNameBn": r["department_name_bn"],
                "departmentNameEn": r["department_name_en"],
                "room": r["room"],
                "status": r["status"],
                "plannedStart": from_datetime(r["planned_start"]),
                "plannedEnd": from_datetime(r["planned_end"]),
                "actualStart": None if r["actual_start"] is None else from_datetime(r["actual_start"]),
                "declaredDelayMinutes": r["declared_delay_minutes"],
                "waiting": r["waiting"],
                "seen": r["seen"],
                "noShows": r["no_shows"],
                "desks": r["desks"],
            }
            for r in rows[:CHAMBER_LIMIT]
        ],
    }
