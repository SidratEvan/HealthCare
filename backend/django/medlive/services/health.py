"""Liveness and readiness (port of `services/health.service.ts`)."""

from __future__ import annotations

import time
from typing import Any

from ..core.env import env
from ..core.logging import logger
from ..core.scope import SYSTEM, db_scope
from ..domain.deployment import deployment_signals
from ..domain.time import from_datetime, from_epoch_ms, now_iso
from ..repositories import health as health_repo
from . import heartbeat

_started_ms = time.time() * 1000


def liveness() -> dict[str, Any]:
    return {"status": "ok", "uptimeSeconds": int((time.time() * 1000 - _started_ms) // 1000)}


def readiness() -> dict[str, Any]:
    try:
        probe = health_repo.probe_database()
    except Exception as error:  # noqa: BLE001 - the reason is logged, never returned
        logger.error({"route": "/readyz"}, "readiness probe failed", exc=error)
        return {
            "status": "degraded",
            "checks": {"database": {"ok": False, "latencyMs": None, "schemaVersion": None}},
            "signals": None,
        }
    return {
        "status": "ready",
        "checks": {
            "database": {
                "ok": probe["reachable"],
                "latencyMs": probe["latencyMs"],
                "schemaVersion": probe["schemaVersion"],
            }
        },
        "signals": _signals(),
    }


def _as_run(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "result": row["result"],
        "finishedAt": from_datetime(row["finishedAt"]),
        "verified": row["verified"],
    }


def _signals() -> dict[str, Any] | None:
    try:
        with db_scope(SYSTEM):
            figures = health_repo.deployment_figures()
        return deployment_signals(
            {
                "now": now_iso(),
                "startedAt": from_epoch_ms(_started_ms),
                "backup": {
                    "maxAgeHours": env().BACKUP_MAX_AGE_HOURS,
                    "last": _as_run(figures["lastBackup"]),
                    "lastOk": _as_run(figures["lastGoodBackup"]),
                },
                "messages": {
                    "due": figures["messagesDue"],
                    "oldestDueAt": None
                    if figures["oldestDueAt"] is None
                    else from_datetime(figures["oldestDueAt"]),
                },
                "workers": heartbeat.snapshot(),
            }
        )
    except Exception:  # noqa: BLE001
        return None
