"""Rate limiting (port of `middleware/rateLimit.ts`; FR-SEC-05, FR-GST-14).

A fixed-window counter in this process's memory, as the Node API has: with
more than one process, a caller gets one window per process. The durable
defences (the five-wrong-codes lock, the code lifetime, sign-in lockout) are
in the database and do not depend on this.
"""

from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass
from typing import Callable

from ..domain.time import now_ms
from .env import env
from .errors import AppError
from .http import ApiRequest

SWEEP_EVERY = 500


@dataclass
class _Window:
    count: int
    reset_at: float


class Counter:
    def __init__(self) -> None:
        self._windows: dict[str, _Window] = {}
        self._sweep_countdown = SWEEP_EVERY
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_seconds: int, now_ms: float) -> tuple[bool, int, int]:
        """`(allowed, remaining, retry_after_seconds)`."""
        with self._lock:
            self._maybe_sweep(now_ms)
            existing = self._windows.get(key)
            if existing is None or existing.reset_at <= now_ms:
                self._windows[key] = _Window(1, now_ms + window_seconds * 1000)
                return True, limit - 1, window_seconds
            existing.count += 1
            retry = max(1, math.ceil((existing.reset_at - now_ms) / 1000))
            return existing.count <= limit, max(0, limit - existing.count), retry

    def reset(self) -> None:
        with self._lock:
            self._windows.clear()

    def size(self) -> int:
        return len(self._windows)

    def _maybe_sweep(self, now_ms: float) -> None:
        self._sweep_countdown -= 1
        if self._sweep_countdown > 0:
            return
        self._sweep_countdown = SWEEP_EVERY
        for key in [k for k, w in self._windows.items() if w.reset_at <= now_ms]:
            del self._windows[key]


counter = Counter()


def by_ip(req: ApiRequest) -> str:
    return req.ip or "unknown"


def by_phone(req: ApiRequest) -> str:
    body = req.body
    if isinstance(body, dict):
        phone = body.get("phone")
        if isinstance(phone, str) and phone != "":
            return f"phone:{phone}"
    return f"ip:{by_ip(req)}"


def rate_limit(
    *,
    limit: int,
    window_seconds: int,
    key_for: Callable[[ApiRequest], str] = by_ip,
    code: str = "RATE_LIMITED",
    bucket: str | None = None,
    address_factor: int | None = None,
) -> Callable[[ApiRequest], None]:
    """A route step. A limit keyed on the address is stretched by
    `ADDRESS_RATE_LIMIT_FACTOR`; one keyed on anything else is a person's."""

    def step(req: ApiRequest) -> None:
        factor = address_factor if address_factor is not None else env().ADDRESS_RATE_LIMIT_FACTOR
        effective = limit * factor if key_for is by_ip else limit
        key = (
            f"{req.method}:{req.api_path}:{key_for(req)}"
            if bucket is None
            else f"{bucket}:{key_for(req)}"
        )
        allowed, remaining, retry = counter.hit(key, effective, window_seconds, now_ms())
        req.response_headers["RateLimit-Limit"] = str(effective)
        req.response_headers["RateLimit-Remaining"] = str(remaining)
        if not allowed:
            req.response_headers["Retry-After"] = str(retry)
            raise AppError(code, details={"retryAfterSeconds": retry})

    return step


ANONYMOUS_PER_MINUTE = 1_200

_anonymous = rate_limit(limit=ANONYMOUS_PER_MINUTE, window_seconds=60, key_for=by_ip, bucket="anonymous")


def anonymous_ceiling(req: ApiRequest) -> None:
    """The ceiling on everything asked without an account (plan I2b); not the webhooks."""
    if req.principal is not None or req.api_path.startswith("/webhooks/"):
        return
    _anonymous(req)
