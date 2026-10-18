"""The only error type the API raises on purpose (port of `errors/AppError.ts`).

Everything a client sees comes through here, which keeps the promise in
BACKEND.md §9: a raw SQL or provider message never reaches a client. The
original cause travels to the log and is dropped from the response.
"""

from __future__ import annotations

from typing import Any, Mapping

from .codes import ERROR_CODES, message_for, status_for


class AppError(Exception):
    """A deliberate refusal: a code, its status, and safe details."""

    expected = True

    def __init__(
        self,
        code: str,
        *,
        message: str | None = None,
        details: Mapping[str, Any] | None = None,
        cause: BaseException | None = None,
    ) -> None:
        if code not in ERROR_CODES:
            raise ValueError(f"unknown error code {code}")
        super().__init__(message if message is not None else message_for(code))
        self.code = code
        self.status = status_for(code)
        self.message = message if message is not None else message_for(code)
        self.details = dict(details) if details is not None else None
        self.__cause__ = cause

    def to_body(self) -> dict[str, Any]:
        """`{ ok: false, error: { code, message, details? } }` (BACKEND.md §7)."""
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details is not None:
            error["details"] = self.details
        return {"ok": False, "error": error}


def auth_required(details: Mapping[str, Any] | None = None) -> AppError:
    return AppError("AUTH_REQUIRED", details=details)


def token_invalid(reason: str) -> AppError:
    return AppError("AUTH_TOKEN_INVALID", details={"reason": reason})


def forbidden_scope(details: Mapping[str, Any] | None = None) -> AppError:
    return AppError("AUTH_FORBIDDEN_SCOPE", details=details)


def not_found(resource: str) -> AppError:
    return AppError("NOT_FOUND", details={"resource": resource})


def validation_failed(details: Mapping[str, Any]) -> AppError:
    return AppError("VALIDATION_FAILED", details=details)


def guard_failed(code: str, detail: str) -> AppError:
    return AppError("QUEUE_GUARD_FAILED", message=detail, details={"guard": code})


class PayloadTooLarge(Exception):
    """The body parser's refusal of a body over its route's limit."""


class BodyNotJson(Exception):
    """The body parser's refusal of a body that is not JSON."""


def as_app_error(thrown: BaseException) -> AppError:
    """Anything thrown that was not an `AppError` becomes a client-safe one.

    The same mapping `asAppError` makes: the parser's refusals are the
    caller's doing, a unique-index race is a conflict, a demonstration's
    refused phone is that refusal, and anything else is `INTERNAL`.
    """
    if isinstance(thrown, AppError):
        return thrown
    if isinstance(thrown, PayloadTooLarge):
        return AppError("PAYLOAD_TOO_LARGE", cause=thrown)
    if isinstance(thrown, BodyNotJson):
        return AppError("VALIDATION_FAILED", details={"body": "not_json"}, cause=thrown)
    sqlstate = getattr(thrown, "sqlstate", None)
    if sqlstate is None:
        inner = getattr(thrown, "__cause__", None)
        sqlstate = getattr(inner, "sqlstate", None)
    if sqlstate == "23505":
        return AppError("WRITE_CONFLICT", cause=thrown)
    # Imported here: validation imports this module.
    from .validation import DemoPhoneRefused

    if isinstance(thrown, DemoPhoneRefused):
        return AppError("DEMO_PHONE_NOT_ALLOWED", cause=thrown)
    return AppError("INTERNAL", cause=thrown)


def is_app_error(thrown: BaseException) -> bool:
    return isinstance(thrown, AppError)
