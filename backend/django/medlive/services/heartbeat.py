"""When each of the clock's jobs last ran (port of `services/heartbeat.service.ts`)."""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any

from ..domain.time import from_datetime, utc_now

_lock = threading.Lock()
_beats: dict[str, dict[str, str | None]] = {}
_intervals: dict[str, int] = {}


def register(worker: str, every_ms: int) -> None:
    with _lock:
        _intervals[worker] = every_ms


def beat(worker: str, ok: bool, at: datetime | None = None) -> None:
    now = from_datetime(at or utc_now())
    with _lock:
        last = _beats.get(worker, {"lastOkAt": None, "lastFailedAt": None})
        _beats[worker] = {**last, "lastOkAt": now} if ok else {**last, "lastFailedAt": now}


def snapshot() -> list[dict[str, Any]]:
    with _lock:
        return [
            {
                "worker": worker,
                "everyMs": every_ms,
                "lastOkAt": _beats.get(worker, {}).get("lastOkAt"),
                "lastFailedAt": _beats.get(worker, {}).get("lastFailedAt"),
            }
            for worker, every_ms in _intervals.items()
        ]


def reset() -> None:
    with _lock:
        _beats.clear()
        _intervals.clear()
