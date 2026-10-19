"""Turns weekly schedules into the chambers patients can book
(port of `services/sessionMaterialise.service.ts`; BACKEND.md §8 `sessions.materialise`, FR-SUP-01).

Writes today and the next seven days at start-up and every hour, and once
more straight after a schedule is added so its chambers appear at once.
Idempotent (`sessions_template_date_key`), so two processes running it at
once write each chamber once.
"""

from __future__ import annotations

from ..core.scope import SYSTEM, db_scope
from ..domain.materialise import MATERIALISE_DAYS, planned_sessions
from ..domain.time import now_iso, to_dhaka_date
from ..repositories import session_materialise as repo

#: Hourly, so a missed midnight is caught within the hour.
MATERIALISE_INTERVAL_MS = 60 * 60 * 1000


def materialise(*, start: str | None = None, only_template: str | None = None) -> int:
    """Writes the chambers from `start` and the seven days after it that do not
    exist yet, and says how many. Runs as the system whoever prompted it: it
    takes nothing from the request but the one schedule to limit itself to."""
    with db_scope(SYSTEM):
        return _materialise_now(start=start, only_template=only_template)


def _materialise_now(*, start: str | None, only_template: str | None) -> int:
    start = start or to_dhaka_date(now_iso())
    schedules = repo.active_schedules(start, only_template)
    if not schedules:
        return 0
    by_schedule = {schedule["id"]: schedule for schedule in schedules}
    planned = planned_sessions(
        [
            {
                "id": schedule["id"],
                "weekday": schedule["weekday"],
                "startTime": schedule["startTime"],
                "endTime": schedule["endTime"],
                "activeFrom": schedule["activeFrom"],
                "activeTo": schedule["activeTo"],
            }
            for schedule in schedules
        ],
        start,
        MATERIALISE_DAYS,
    )
    rows = []
    for session in planned:
        schedule = by_schedule.get(session["templateId"])
        if schedule is None:
            continue
        rows.append(
            {
                "templateId": schedule["id"],
                "hospitalId": schedule["hospitalId"],
                "doctorId": schedule["doctorId"],
                "departmentId": schedule["departmentId"],
                "room": schedule["room"],
                "sessionDate": session["sessionDate"],
                "plannedStart": session["plannedStart"],
                "plannedEnd": session["plannedEnd"],
                "capacity": schedule["capacity"],
                "feePoisha": schedule["feePoisha"],
            }
        )
    return repo.insert_missing(rows)
