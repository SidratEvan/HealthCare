"""When a message goes, and when it is tried again (port of `shared/domain/src/messaging/sending.ts`)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from .time import from_epoch_ms, to_epoch_ms

SEND_MAX_ATTEMPTS = 5
SEND_RETRY_SECONDS = (15, 60, 300, 900)
SEND_CLAIM_SECONDS = 120
QUIET_FROM_HOUR = 22
QUIET_UNTIL_HOUR = 7
DHAKA_OFFSET_MS = 6 * 3_600_000

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def after_failed_send(*, attempts: int, now: str, retryable: bool) -> dict[str, Any]:
    if not retryable or attempts >= SEND_MAX_ATTEMPTS:
        return {"kind": "give_up"}
    index = max(0, attempts - 1)
    wait = SEND_RETRY_SECONDS[index] if index < len(SEND_RETRY_SECONDS) else SEND_RETRY_SECONDS[-1]
    return {"kind": "retry", "at": from_epoch_ms(to_epoch_ms(now) + wait * 1000)}


def _local(at: str) -> datetime:
    return _EPOCH + timedelta(milliseconds=to_epoch_ms(at) + DHAKA_OFFSET_MS)


def dhaka_hour(at: str) -> int:
    return _local(at).hour


def in_quiet_hours(at: str) -> bool:
    hour = dhaka_hour(at)
    return hour >= QUIET_FROM_HOUR or hour < QUIET_UNTIL_HOUR


def end_of_quiet_hours(at: str) -> str:
    if not in_quiet_hours(at):
        return at
    local = _local(at)
    morning = datetime(local.year, local.month, local.day, QUIET_UNTIL_HOUR, tzinfo=timezone.utc)
    if local.hour >= QUIET_FROM_HOUR:
        morning += timedelta(days=1)
    return from_epoch_ms((morning - _EPOCH) / timedelta(milliseconds=1) - DHAKA_OFFSET_MS)
