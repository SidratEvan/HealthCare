"""Instants and Dhaka calendar dates (port of `shared/domain/src/util/time.ts`).

Timestamps travel as ISO-8601 strings, exactly as in the TypeScript, and the
arithmetic is done in epoch milliseconds. Two JavaScript behaviours are kept
on purpose, because ETAs and quotes depend on them:

- `js_round` is `Math.round` (half rounds up), not Python's `round` (half to
  even): `js_round(2.5) == 3`, `round(2.5) == 2`.
- `js_trunc` is `Math.trunc` (toward zero).
"""

from __future__ import annotations

import contextvars
import math
import re
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Iterator

DHAKA_UTC_OFFSET_MINUTES = 360

MS_PER_SECOND = 1000
MS_PER_MINUTE = 60 * MS_PER_SECOND

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_DATE_ONLY = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})$")
_INSTANT = re.compile(
    r"^([+-][0-9]{6}|[0-9]{4})-([0-9]{2})-([0-9]{2})[T ]([0-9]{2}):([0-9]{2})"
    r"(?::([0-9]{2})(?:\.([0-9]+))?)?\s*(Z|z|[+-][0-9]{2}(?::?[0-9]{2})?)?$"
)


def js_round(value: float) -> int:
    """JavaScript's `Math.round`."""
    return math.floor(value + 0.5)


def js_trunc(value: float) -> int:
    """JavaScript's `Math.trunc`."""
    return math.trunc(value)


def parse_ms(value: str) -> float:
    """`Date.parse(value)` for the ISO shapes this codebase produces; NaN otherwise."""
    if not isinstance(value, str):
        return math.nan
    text = value.strip()
    m = _DATE_ONLY.fullmatch(text)
    if m:
        try:
            dt = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=timezone.utc)
        except ValueError:
            return math.nan
        return (dt - _EPOCH) / timedelta(milliseconds=1)
    m = _INSTANT.fullmatch(text)
    if not m:
        return math.nan
    year, month, day, hour, minute, second, fraction, zone = m.groups()
    try:
        dt = datetime(
            int(year),
            int(month),
            int(day),
            int(hour),
            int(minute),
            int(second or 0),
            tzinfo=timezone.utc,
        )
    except ValueError:
        return math.nan
    ms = (dt - _EPOCH) // timedelta(milliseconds=1)
    if fraction:
        ms += int((fraction + "000")[:3])
    if zone is None:
        # `Date.parse` reads a date-time without a zone as local time; every
        # instant this codebase writes has one, and the server runs in UTC.
        return float(ms)
    if zone not in ("Z", "z"):
        sign = 1 if zone[0] == "+" else -1
        digits = zone[1:].replace(":", "")
        offset = int(digits[:2]) * 60 + (int(digits[2:4]) if len(digits) >= 4 else 0)
        ms -= sign * offset * MS_PER_MINUTE
    return float(ms)


def to_epoch_ms(value: str) -> float:
    ms = parse_ms(value)
    if math.isnan(ms):
        raise TypeError(f"Not an ISO-8601 instant: {value}")
    return ms


def from_epoch_ms(ms: float) -> str:
    """`new Date(ms).toISOString()`."""
    if not math.isfinite(ms):
        raise TypeError(f"Not a finite epoch: {ms}")
    whole = int(math.floor(ms))
    dt = _EPOCH + timedelta(milliseconds=whole)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def from_datetime(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# The one clock the API reads. Only the test seam moves it (`core/pipeline.py`,
# under NODE_ENV=test): a test that fakes `Date` in the Node process sends its
# time with each request, as `vi.setSystemTime` would move the Node API's.
_offset_ms: contextvars.ContextVar[float] = contextvars.ContextVar("clock_offset_ms", default=0.0)


def utc_now() -> datetime:
    return datetime.now(timezone.utc) + timedelta(milliseconds=_offset_ms.get())


@contextmanager
def clock_at(epoch_ms: float) -> Iterator[None]:
    """Runs the body as if it were `epoch_ms` now (tests only)."""
    token = _offset_ms.set(epoch_ms - datetime.now(timezone.utc).timestamp() * 1000)
    try:
        yield
    finally:
        _offset_ms.reset(token)


def now_iso() -> str:
    return from_datetime(utc_now())


def now_ms() -> float:
    return float(math.floor(utc_now().timestamp() * 1000))


def add_seconds(value: str, seconds: float) -> str:
    return from_epoch_ms(to_epoch_ms(value) + js_round(seconds) * MS_PER_SECOND)


def add_minutes(value: str, minutes: float) -> str:
    return from_epoch_ms(to_epoch_ms(value) + js_round(minutes * MS_PER_MINUTE))


def difference_in_seconds(to: str, frm: str) -> int:
    return js_round((to_epoch_ms(to) - to_epoch_ms(frm)) / MS_PER_SECOND)


def difference_in_minutes(to: str, frm: str) -> int:
    return js_round((to_epoch_ms(to) - to_epoch_ms(frm)) / MS_PER_MINUTE)


def difference_in_hours(to: str, frm: str) -> int:
    return js_trunc(difference_in_minutes(to, frm) / 60)


def max_timestamp(a: str, b: str) -> str:
    return a if to_epoch_ms(a) >= to_epoch_ms(b) else b


def min_timestamp(a: str, b: str) -> str:
    return a if to_epoch_ms(a) <= to_epoch_ms(b) else b


def is_before(a: str, b: str) -> bool:
    return to_epoch_ms(a) < to_epoch_ms(b)


def is_after(a: str, b: str) -> bool:
    return to_epoch_ms(a) > to_epoch_ms(b)


def _shifted(value: str) -> datetime:
    ms = to_epoch_ms(value) + DHAKA_UTC_OFFSET_MINUTES * MS_PER_MINUTE
    return _EPOCH + timedelta(milliseconds=int(math.floor(ms)))


def to_dhaka_date(value: str) -> str:
    return _shifted(value).strftime("%Y-%m-%d")


def to_dhaka_clock(value: str) -> dict[str, int]:
    shifted = _shifted(value)
    return {"hour": shifted.hour, "minute": shifted.minute}


def from_dhaka_wall_clock(date: str, hour: int, minute: int) -> str:
    if not _DATE_ONLY.fullmatch(date):
        raise TypeError(f"Not a YYYY-MM-DD date: {date}")
    if not isinstance(hour, int) or hour < 0 or hour > 23:
        raise ValueError(f"Hour out of range: {hour}")
    if not isinstance(minute, int) or minute < 0 or minute > 59:
        raise ValueError(f"Minute out of range: {minute}")
    midnight = parse_ms(f"{date}T00:00:00Z")
    if math.isnan(midnight):
        # `Date.parse` of an impossible date is NaN, and `fromEpochMs` throws.
        raise TypeError(f"Not a finite epoch: {midnight}")
    return from_epoch_ms(midnight + (hour * 60 + minute - DHAKA_UTC_OFFSET_MINUTES) * MS_PER_MINUTE)


def dhaka_weekday(value: str) -> int:
    """Monday 1 ... Sunday 7, in Dhaka."""
    return _shifted(value).isoweekday()


def floor_to_minute(value: str) -> str:
    ms = to_epoch_ms(value)
    return from_epoch_ms(ms - (ms % MS_PER_MINUTE))
