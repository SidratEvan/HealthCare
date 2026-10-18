"""The process's own clock work (port of `server.ts`'s timers).

Started by the ASGI lifespan when `RUN_BACKGROUND_JOBS` is on. Each job is
ported with its module; the outbox sender is first, because every message the
queue writes waits on it.
"""

from __future__ import annotations

from . import notification_sender


def start_background() -> None:
    notification_sender.start_sender()


def stop_background() -> None:
    notification_sender.stop_sender()
