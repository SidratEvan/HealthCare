"""Sends what the outbox holds (port of `services/notificationSender.service.ts`; plan H1).

The outbox row is the truth. A request that wrote messages hands them here
after its commit, with their words, so they go out at once; anything not in
memory (a restart, a retry, a held message) is rebuilt from the row, its link
issued afresh. Rows are claimed with `FOR UPDATE SKIP LOCKED`, so two
processes never send one message twice.

One sender thread per process: woken by `hand`, and every five seconds.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any

from ..adapters.push import push
from ..adapters.sms import sms
from ..core.logging import logger
from ..core.scope import SYSTEM, db_scope
from ..domain.messaging import SEND_CLAIM_SECONDS, after_failed_send
from ..domain.time import now_iso, parse_ms
from ..repositories import notification as notification_repo
from . import heartbeat
from .links import reissue_link

SENDER_TICK_SECONDS = 5.0
CLAIM_BATCH = 20
KEEP_IN_MEMORY_SECONDS = 30 * 60

_lock = threading.Lock()
_in_memory: dict[str, tuple[dict[str, Any], float]] = {}
_wake = threading.Event()
_idle = threading.Event()
_idle.set()
_stop = threading.Event()
_thread: threading.Thread | None = None
_draining = False


def hand(messages: list[dict[str, Any]]) -> None:
    """Messages written by a committed transaction, to send now."""
    if not messages:
        return
    since = time.monotonic()
    with _lock:
        for message in messages:
            _in_memory[message["id"]] = (message, since)
    wake()


def wake() -> None:
    _idle.clear()
    _wake.set()
    _ensure_thread()


def idle(timeout: float = 30.0) -> bool:
    """Waits until nothing is being sent (the tests' `settled()`)."""
    return _idle.wait(timeout)


def _ensure_thread() -> None:
    global _thread
    with _lock:
        if _thread is not None and _thread.is_alive():
            return
        _stop.clear()
        _thread = threading.Thread(target=_run, name="notification-sender", daemon=True)
        _thread.start()


def start_sender() -> None:
    heartbeat.register("sender", int(SENDER_TICK_SECONDS * 1000))
    wake()


def stop_sender() -> None:
    _stop.set()
    _wake.set()


def _run() -> None:
    global _draining
    from django.db import close_old_connections

    while not _stop.is_set():
        _wake.wait(SENDER_TICK_SECONDS)
        _wake.clear()
        if _stop.is_set():
            break
        _draining = True
        try:
            with db_scope(SYSTEM):
                _drain()
            heartbeat.beat("sender", True)
        except Exception as error:  # noqa: BLE001
            heartbeat.beat("sender", False)
            logger.error({}, "notification sender failed; the next tick tries again", exc=error)
        finally:
            _draining = False
            close_old_connections()
            if not _wake.is_set():
                _idle.set()


def _drain() -> None:
    _forget_old()
    while True:
        claimed = notification_repo.claim_due(CLAIM_BATCH, SEND_CLAIM_SECONDS)
        if not claimed:
            return
        for row in claimed:
            _send_one(row)


def _forget_old() -> None:
    before = time.monotonic() - KEEP_IN_MEMORY_SECONDS
    with _lock:
        for key in [k for k, (_, since) in _in_memory.items() if since < before]:
            del _in_memory[key]


def _send_one(row: dict[str, Any]) -> None:
    try:
        with _lock:
            held = _in_memory.get(row["id"])
        message: dict[str, Any] | str = held[0] if held is not None else _from_row(row)
        outcome = (
            {"kind": "failed", "error": message, "retryable": False}
            if isinstance(message, str)
            else _attempt(message)
        )
    except Exception as error:  # noqa: BLE001
        logger.error({"notificationId": row["id"], "templateKey": row["templateKey"]}, "sending a notification threw", exc=error)
        outcome = {"kind": "failed", "error": "dispatch_threw", "retryable": True}

    try:
        if outcome["kind"] == "sent":
            notification_repo.mark_sent(row["id"], provider_ref=outcome["providerRef"], cost_poisha=outcome["costPoisha"])
        elif outcome["kind"] == "skipped":
            notification_repo.mark_not_sent(row["id"], "skipped", outcome["reason"])
        else:
            following = after_failed_send(attempts=row["attempts"], now=now_iso(), retryable=outcome["retryable"])
            if following["kind"] == "retry":
                at = datetime.fromtimestamp(parse_ms(following["at"]) / 1000, tz=timezone.utc)
                notification_repo.retry_at(row["id"], at, outcome["error"])
                return
            notification_repo.mark_not_sent(row["id"], "failed", outcome["error"])
            logger.warn(
                {"notificationId": row["id"], "templateKey": row["templateKey"], "attempts": row["attempts"]},
                "notification given up on",
            )
        with _lock:
            _in_memory.pop(row["id"], None)
    except Exception as error:  # noqa: BLE001
        logger.error({"notificationId": row["id"]}, "recording a send failed", exc=error)


def _from_row(row: dict[str, Any]) -> dict[str, Any] | str:
    kept = row["params"].get("body") if isinstance(row["params"], dict) else None
    if not isinstance(kept, str) or kept == "":
        return "words_not_kept"
    body = kept
    if "{link}" in kept:
        link = reissue_link(row["params"], row["phone"])
        if link is None:
            return "link_unavailable"
        body = link.join(kept.split("{link}"))
    return {
        "id": row["id"],
        "channel": row["channel"],
        "to": row["phone"] if row["channel"] == "sms" else None,
        "body": body,
        "templateKey": row["templateKey"],
        "recipient": row["recipient"],
    }


def _attempt(message: dict[str, Any]) -> dict[str, Any]:
    if message["channel"] == "sms":
        if message["to"] is None:
            return {"kind": "skipped", "reason": "no_phone_number"}
        result = sms().send(
            to=message["to"], body=message["body"], notification_id=message["id"], template_key=message["templateKey"]
        )
        if result.ok:
            return {"kind": "sent", "providerRef": result.provider_ref, "costPoisha": result.cost_poisha}
        return {"kind": "failed", "error": result.error, "retryable": True if result.retryable is None else result.retryable}
    tokens = notification_repo.device_tokens_for(message["recipient"])
    result = push().send(
        tokens=tokens, body=message["body"], notification_id=message["id"], template_key=message["templateKey"], url=None
    )
    if result.ok:
        return {"kind": "sent", "providerRef": result.provider_ref, "costPoisha": None}
    if result.error == "no_device_token":
        return {"kind": "skipped", "reason": result.error}
    return {"kind": "failed", "error": result.error, "retryable": True}


def forget_in_memory() -> None:
    with _lock:
        _in_memory.clear()
