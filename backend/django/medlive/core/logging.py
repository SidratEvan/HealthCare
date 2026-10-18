"""Structured JSON logging with redaction (port of `config/logger.ts`).

CLAUDE.md §7: never log patient identifiers, OTPs, tokens or payment
references. The redaction happens in the logger itself, by key, at any depth,
so a call site that forgets is still covered.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any

#: Keys scrubbed from every log line, wherever they appear (`REDACTED_PATHS`).
REDACTED_KEYS = frozenset(
    {
        "authorization",
        "cookie",
        "x-guest-token",
        "idempotency-key",
        "password",
        "passwordHash",
        "token",
        "tokenHash",
        "accessToken",
        "refreshToken",
        "guestToken",
        "totpSecret",
        "secret",
        "otp",
        "phone",
        "contactPhone",
        "nationalId",
        "fullName",
        "name",
        "dateOfBirth",
        "bloodGroup",
        "diagnosis",
        "diagnosisText",
        "notes",
        "intake",
        "advice",
        "providerRef",
        "paymentRef",
        "idempotencyKey",
    }
)
# `*.code` is redacted in the Node logger too, but an error's `code` is the one
# thing a refusal log line exists to carry; pino's path `*.code` only matches
# one level down, and the top-level `code` survives there. The same here.
_NESTED_ONLY = frozenset({"code"})

_LEVELS = {
    "trace": 5,
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warn": logging.WARNING,
    "error": logging.ERROR,
    "fatal": logging.CRITICAL,
}
logging.addLevelName(5, "TRACE")

_NAMES = {5: "trace", 10: "debug", 20: "info", 30: "warn", 40: "error", 50: "fatal"}


def redact(value: Any, depth: int = 0) -> Any:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            if key in REDACTED_KEYS or (depth > 0 and key in _NESTED_ONLY):
                out[key] = "[redacted]"
            else:
                out[key] = redact(item, depth + 1)
        return out
    if isinstance(value, (list, tuple)):
        return [redact(item, depth + 1) for item in value]
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        fields: dict[str, Any] = {
            "level": _NAMES.get(record.levelno, record.levelname.lower()),
            "time": datetime.fromtimestamp(record.created, tz=timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "service": "api",
        }
        extra = getattr(record, "fields", None)
        if isinstance(extra, dict):
            fields.update(redact(extra))
        if record.exc_info:
            # The exception's type and traceback, never its arguments' values
            # beyond what the message carries; SQL parameters are not logged.
            fields["err"] = self.formatException(record.exc_info)
        fields["msg"] = record.getMessage()
        return json.dumps(fields, default=str, ensure_ascii=False)


_configured = False


def configure(level: str, silent: bool) -> None:
    global _configured
    root = logging.getLogger("medlive")
    root.handlers.clear()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.propagate = False
    root.setLevel(logging.CRITICAL + 10 if silent else _LEVELS[level])
    _configured = True


class Logger:
    """A pino-shaped logger: `log.info({"field": 1}, "message")`."""

    def __init__(self, bound: dict[str, Any] | None = None) -> None:
        self._logger = logging.getLogger("medlive")
        self._bound = bound or {}

    def child(self, fields: dict[str, Any]) -> "Logger":
        return Logger({**self._bound, **fields})

    def _log(self, level: int, fields: dict[str, Any] | str, message: str | None, exc: Any) -> None:
        if isinstance(fields, str):
            message, fields = fields, {}
        if not self._logger.isEnabledFor(level):
            return
        self._logger.log(
            level,
            message or "",
            extra={"fields": {**self._bound, **fields}},
            exc_info=exc,
        )

    def trace(self, fields: dict[str, Any] | str, message: str | None = None) -> None:
        self._log(5, fields, message, None)

    def debug(self, fields: dict[str, Any] | str, message: str | None = None) -> None:
        self._log(logging.DEBUG, fields, message, None)

    def info(self, fields: dict[str, Any] | str, message: str | None = None) -> None:
        self._log(logging.INFO, fields, message, None)

    def warn(self, fields: dict[str, Any] | str, message: str | None = None) -> None:
        self._log(logging.WARNING, fields, message, None)

    def error(
        self, fields: dict[str, Any] | str, message: str | None = None, exc: Any = None
    ) -> None:
        self._log(logging.ERROR, fields, message, exc)

    def fatal(
        self, fields: dict[str, Any] | str, message: str | None = None, exc: Any = None
    ) -> None:
        self._log(logging.CRITICAL, fields, message, exc)


logger = Logger()


def request_logger(request_id: str) -> Logger:
    return logger.child({"requestId": request_id})
