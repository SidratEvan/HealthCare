"""Readiness reads (port of `repositories/health.repo.ts`)."""

from __future__ import annotations

import time
from typing import Any

from ..core import db


def probe_database() -> dict[str, Any]:
    started = time.perf_counter()
    row = db.fetch_one("SELECT (SELECT max(version) FROM schema_migrations) AS version")
    latency = (time.perf_counter() - started) * 1000
    return {
        "reachable": True,
        "latencyMs": int(latency + 0.5),
        "schemaVersion": None if row is None else row["version"],
    }


def deployment_figures() -> dict[str, Any]:
    runs = db.fetch_all(
        """
        (SELECT result, finished_at, verified, true AS newest
           FROM backup_runs ORDER BY finished_at DESC, id DESC LIMIT 1)
        UNION ALL
        (SELECT result, finished_at, verified, false AS newest
           FROM backup_runs WHERE result = 'ok' ORDER BY finished_at DESC, id DESC LIMIT 1)
        """
    )
    due = db.fetch_one(
        """
        SELECT count(*)::int AS due, min(next_attempt_at) AS oldest
          FROM notifications
         WHERE state = 'queued' AND next_attempt_at <= now()
        """
    )

    def as_run(row: dict[str, Any] | None) -> dict[str, Any] | None:
        if row is None:
            return None
        return {"result": row["result"], "finishedAt": row["finished_at"], "verified": row["verified"]}

    return {
        "lastBackup": as_run(next((r for r in runs if r["newest"]), None)),
        "lastGoodBackup": as_run(next((r for r in runs if not r["newest"]), None)),
        "messagesDue": (due or {}).get("due") or 0,
        "oldestDueAt": (due or {}).get("oldest"),
    }
