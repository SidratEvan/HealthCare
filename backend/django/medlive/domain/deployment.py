"""What a deployment says about itself (port of `shared/domain/src/org/deployment.ts`).

Backups, messages waiting, and the clock's own work, read by `/readyz` and
the platform's health screen.
"""

from __future__ import annotations

import math
from typing import Any

from .time import parse_ms

MESSAGE_WAITING_MINUTES = 5

DEPLOYMENT_WORKERS: tuple[str, ...] = ("sender", "offers", "hourly", "payments")
WORKER_LATE_INTERVALS = 3
DEPLOYMENT_ATTENTIONS: tuple[str, ...] = (
    "backup_failed",
    "backup_stale",
    "backup_none",
    "messages_overdue",
    "worker_late",
)

HOUR_MS = 3_600_000
MINUTE_MS = 60_000


def _since(now: float, at: str | None) -> float | None:
    return None if at is None else max(0.0, now - parse_ms(at))


def deployment_signals(data: dict[str, Any]) -> dict[str, Any]:
    now = parse_ms(data["now"])
    up = _since(now, data["startedAt"]) or 0.0
    attention: set[str] = set()

    backup = data["backup"]
    max_age_hours = backup["maxAgeHours"]
    last = backup["last"]
    last_ok = backup["lastOk"]
    watched = max_age_hours is not None
    ok_age = _since(now, last_ok["finishedAt"] if last_ok else None)
    if watched:
        allowance = max_age_hours * HOUR_MS
        if last is not None and last["result"] == "failed":
            attention.add("backup_failed")
        if ok_age is not None and ok_age > allowance:
            attention.add("backup_stale")
        if last is None and up > allowance:
            attention.add("backup_none")

    messages = data["messages"]
    waited = _since(now, messages["oldestDueAt"])
    if messages["due"] > 0 and waited is not None and waited > MESSAGE_WAITING_MINUTES * MINUTE_MS:
        attention.add("messages_overdue")

    workers = []
    for beat in data["workers"]:
        ago = _since(now, beat["lastOkAt"])
        quiet = ago if ago is not None else up
        late = quiet > WORKER_LATE_INTERVALS * beat["everyMs"]
        if late:
            attention.add("worker_late")
        workers.append(
            {
                "worker": beat["worker"],
                "everySeconds": math.floor(beat["everyMs"] / 1000 + 0.5),
                "lastOkSecondsAgo": None if ago is None else math.floor(ago / 1000),
                "late": late,
            }
        )

    return {
        "backup": {
            "watched": watched,
            "lastResult": last["result"] if last else None,
            "lastAt": last["finishedAt"] if last else None,
            "lastOkAt": last_ok["finishedAt"] if last_ok else None,
            "lastOkVerified": last_ok["verified"] if last_ok else None,
            "lastOkHoursAgo": None if ok_age is None else math.floor(ok_age / HOUR_MS),
        },
        "messages": {
            "due": messages["due"],
            "oldestDueMinutes": None if waited is None else math.floor(waited / MINUTE_MS),
        },
        "workers": workers,
        "attention": [one for one in DEPLOYMENT_ATTENTIONS if one in attention],
    }
