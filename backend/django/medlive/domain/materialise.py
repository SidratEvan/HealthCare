"""Which chambers a hospital's weekly schedule makes (port of `sessions/materialise.ts`;
DATABASE.md §2.3 `session_templates`, FR-SUP-01).

Pure. The job that writes them inserts each only if that schedule has no live
session on that date yet (`sessions_template_date_key`), so working the same
answer out twice writes nothing twice.
"""

from __future__ import annotations

import re
from typing import Any

from .time import add_minutes, dhaka_weekday, from_dhaka_wall_clock, to_dhaka_date

#: Today and the next seven days (the patient app books seven days ahead).
MATERIALISE_DAYS = 8

_CLOCK = re.compile(r"^([0-9]{2}):([0-9]{2})(?::[0-9]{2})?\Z")


def _clock(value: str) -> tuple[int, int]:
    match = _CLOCK.match(value)
    if match is None:
        raise ValueError(f"Not a HH:MM time: {value}")
    return int(match.group(1)), int(match.group(2))


def add_dhaka_days(date: str, days: int) -> str:
    """A Dhaka date `days` later. Dhaka keeps no daylight saving, so a day is 24 hours."""
    return to_dhaka_date(add_minutes(from_dhaka_wall_clock(date, 12, 0), days * 24 * 60))


def planned_sessions(templates: list[dict[str, Any]], start: str, days: int = MATERIALISE_DAYS) -> list[dict[str, str]]:
    planned: list[dict[str, str]] = []
    for offset in range(days):
        date = add_dhaka_days(start, offset)
        weekday = dhaka_weekday(from_dhaka_wall_clock(date, 12, 0))
        for template in templates:
            if template["weekday"] != weekday:
                continue
            if date < template["activeFrom"]:
                continue
            if template["activeTo"] is not None and date > template["activeTo"]:
                continue
            start_hour, start_minute = _clock(template["startTime"])
            end_hour, end_minute = _clock(template["endTime"])
            planned.append(
                {
                    "templateId": template["id"],
                    "sessionDate": date,
                    "plannedStart": from_dhaka_wall_clock(date, start_hour, start_minute),
                    "plannedEnd": from_dhaka_wall_clock(date, end_hour, end_minute),
                }
            )
    return planned
