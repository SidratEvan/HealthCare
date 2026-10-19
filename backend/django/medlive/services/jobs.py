"""The process's own clock work (ports of `services/jobs.service.ts`,
`services/queueTimers.service.ts`, `services/paymentHolds.service.ts` and the
timers `server.ts` starts; BACKEND.md §8).

Started by the ASGI lifespan when `RUN_BACKGROUND_JOBS` is on:

- the outbox sender (every five seconds, and woken by each commit);
- hourly, at start-up and then every hour: chambers from schedules
  (`SESSION_MATERIALISE`), imported rows cleared 30 days after their batch
  closed (FR-IMP-08), and the words of messages cleared after 90 days
  (DATABASE.md §8). Each job fails on its own and is logged; the hour is
  reported to the heartbeat as having gone through only when every job did;
- every thirty seconds, offers whose window has closed are recorded as
  lapsed (FR-QUE-30), each chamber on its own;
- every thirty seconds, payment holds that ran out are dealt with and
  recently expired attempts asked about again (FR-PAY-08, FR-PAY-10).

Each loop is a daemon thread that waits on one stop event, so stopping the
process stops all of them at once. All of it runs as the server's own work.
"""

from __future__ import annotations

import threading
from typing import Callable

from ..core.env import env
from ..core.logging import logger
from ..core.scope import SYSTEM, db_scope
from . import heartbeat, notification_sender

HOURLY_SECONDS = 60 * 60
OFFER_TICK_SECONDS = 30
PAYMENT_TICK_SECONDS = 30

_stop = threading.Event()
_threads: list[threading.Thread] = []


def _loop(name: str, every_seconds: float, run: Callable[[], None], *, now_first: bool) -> threading.Thread:
    def body() -> None:
        if now_first:
            run()
        while not _stop.wait(every_seconds):
            run()

    thread = threading.Thread(target=body, name=f"medlive-{name}", daemon=True)
    thread.start()
    return thread


def run_hourly() -> bool:
    """One hour's jobs. True when every one went through."""
    from .imports import purge_expired
    from .notification import clear_expired_bodies
    from .session_materialise import materialise

    ok = True
    if env().SESSION_MATERIALISE:
        try:
            written = materialise()
            if written > 0:
                logger.info({"written": written}, "sessions materialised from schedules")
        except Exception as error:
            ok = False
            logger.error({"err": error}, "session materialisation failed; retrying next hour")
    try:
        with db_scope(SYSTEM):
            batches = purge_expired()
        if batches > 0:
            logger.info({"batches": batches}, "imported rows cleared after 30 days")
    except Exception as error:
        ok = False
        logger.error({"err": error}, "clearing old imported rows failed; retrying next hour")
    try:
        with db_scope(SYSTEM):
            messages = clear_expired_bodies()
        if messages > 0:
            logger.info({"messages": messages}, "message text cleared after 90 days")
    except Exception as error:
        ok = False
        logger.error({"err": error}, "clearing old message text failed; retrying next hour")
    heartbeat.beat("hourly", ok)
    return ok


def lapse_due_offers() -> int:
    """Records every offer whose window has closed. One chamber failing does not stop the rest."""
    from ..domain.time import utc_now
    from ..repositories import standby as standby_repo
    from . import queue as queue_service

    lapsed = 0
    with db_scope(SYSTEM):
        for session_id in standby_repo.sessions_with_overdue_offers(utc_now()):
            try:
                lapsed += queue_service.expire_lapsed_offers(session_id, {"kind": "system", "job": "offers_expire"})
            except Exception as error:
                logger.warn({"sessionId": session_id, "err": error}, "could not lapse offers; the next tick tries again")
    return lapsed


def _run_offers() -> None:
    try:
        lapsed = lapse_due_offers()
        heartbeat.beat("offers", True)
        if lapsed > 0:
            logger.info({"lapsed": lapsed}, "slot offers lapsed")
    except Exception as error:
        heartbeat.beat("offers", False)
        logger.error({"err": error}, "looking for lapsed offers failed; the next tick tries again")


def _run_payments() -> None:
    from ..domain.time import utc_now
    from .payment import ask_again_after_expiry, expire_holds

    try:
        now = utc_now()
        expired = expire_holds(now)
        asked = ask_again_after_expiry(now)
        heartbeat.beat("payments", True)
        if expired > 0 or asked > 0:
            logger.info({"expired": expired, "asked": asked}, "payment holds looked at")
    except Exception as error:
        heartbeat.beat("payments", False)
        logger.error({"err": error}, "payment holds failed; the next tick tries again")


def start_background() -> None:
    _stop.clear()
    notification_sender.start_sender()
    heartbeat.register("hourly", HOURLY_SECONDS * 1000)
    heartbeat.register("offers", OFFER_TICK_SECONDS * 1000)
    heartbeat.register("payments", PAYMENT_TICK_SECONDS * 1000)
    _threads.append(_loop("hourly", HOURLY_SECONDS, run_hourly, now_first=True))
    _threads.append(_loop("offers", OFFER_TICK_SECONDS, _run_offers, now_first=False))
    _threads.append(_loop("payments", PAYMENT_TICK_SECONDS, _run_payments, now_first=False))


def stop_background() -> None:
    _stop.set()
    notification_sender.stop_sender()
    for thread in _threads:
        thread.join(timeout=5)
    _threads.clear()
