"""SMS behind an adapter (port of `adapters/sms.ts` and `adapters/smsHttp.ts`).

`SMS_PROVIDER=log` records and sends nothing: the correct implementation for
the pitch version (CLAUDE.md §1.1). `http` is an aggregator reached over
HTTPS with signed delivery receipts (plan H2), built against a documented
interface and not yet activated with any provider. `local` refuses
everything.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol

from ..core.env import env
from ..core.logging import logger

POISHA_PER_SEGMENT = 35
UCS2_SEGMENT = 70
SMS_SEND_TIMEOUT_SECONDS = 10

_DELIVERED = {"delivered", "delivrd", "success", "successful"}
_FAILED = {"failed", "undelivered", "undeliv", "rejected", "rejectd", "expired"}


def segments_for(body: str) -> int:
    """Segments a Bangla (UCS-2) message takes: seventy UTF-16 units each."""
    units = len(body.encode("utf-16-le")) // 2
    return max(1, math.ceil(units / UCS2_SEGMENT))


@dataclass(frozen=True)
class SmsResult:
    ok: bool
    provider_ref: str | None = None
    cost_poisha: int | None = None
    error: str | None = None
    retryable: bool | None = None


class SmsAdapter(Protocol):
    name: str
    reports_delivery: bool

    def send(self, *, to: str, body: str, notification_id: str, template_key: str, sensitive: bool = False) -> SmsResult: ...

    def verify_receipt(self, raw_body: str, signature: str | None) -> bool: ...

    def read_receipt(self, body: Any) -> dict[str, Any] | None: ...


class LogSmsAdapter:
    name = "log"
    reports_delivery = False

    def send(self, *, to: str, body: str, notification_id: str, template_key: str, sensitive: bool = False) -> SmsResult:
        segments = segments_for(body)
        logger.info(
            {"notificationId": notification_id, "templateKey": template_key, "channel": "sms", "segments": segments},
            "sms recorded, not sent: SMS_PROVIDER=log has no aggregator behind it",
        )
        return SmsResult(ok=True, provider_ref=f"log:{notification_id}", cost_poisha=segments * POISHA_PER_SEGMENT)

    def verify_receipt(self, raw_body: str, signature: str | None) -> bool:
        return False

    def read_receipt(self, body: Any) -> dict[str, Any] | None:
        return None


class UnconfiguredSmsAdapter:
    name = "unconfigured"
    reports_delivery = False

    def send(self, *, to: str, body: str, notification_id: str, template_key: str, sensitive: bool = False) -> SmsResult:
        return SmsResult(ok=False, error="no_sms_provider_configured")

    def verify_receipt(self, raw_body: str, signature: str | None) -> bool:
        return False

    def read_receipt(self, body: Any) -> dict[str, Any] | None:
        return None


def _read_id(body: Any) -> str | None:
    if not isinstance(body, dict):
        return None
    value = body.get("id")
    if not isinstance(value, str):
        return None
    identifier = value.strip()
    return None if identifier == "" or len(identifier) > 200 else identifier


def _not_worth_retrying(status: int) -> bool:
    return 400 <= status < 500 and status not in (408, 429)


class HttpSmsAdapter:
    name = "http"
    reports_delivery = True

    def __init__(
        self,
        *,
        url: str | None = None,
        api_key: str | None = None,
        sender_id: str | None = None,
        receipt_secret: str | None = None,
        timeout_seconds: float = SMS_SEND_TIMEOUT_SECONDS,
    ) -> None:
        e = env()
        self.url = e.SMS_API_URL if url is None else url
        self.api_key = e.SMS_API_KEY if api_key is None else api_key
        self.sender_id = e.SMS_SENDER_ID if sender_id is None else sender_id
        self.receipt_secret = e.SMS_DLR_SECRET if receipt_secret is None else receipt_secret
        self.timeout_seconds = timeout_seconds

    def send(self, *, to: str, body: str, notification_id: str, template_key: str, sensitive: bool = False) -> SmsResult:
        request = urllib.request.Request(
            self.url,
            data=json.dumps(
                {"to": to, "text": body, "senderId": self.sender_id, "reference": notification_id},
                ensure_ascii=False,
            ).encode("utf8"),
            headers={"authorization": f"Bearer {self.api_key}", "content-type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                raw = response.read()
        except urllib.error.HTTPError as error:
            return SmsResult(
                ok=False, error=f"gateway_http_{error.code}", retryable=not _not_worth_retrying(error.code)
            )
        except (socket.timeout, TimeoutError):
            return SmsResult(ok=False, error="gateway_timeout")
        except (urllib.error.URLError, OSError) as error:
            if isinstance(getattr(error, "reason", None), (socket.timeout, TimeoutError)):
                return SmsResult(ok=False, error="gateway_timeout")
            return SmsResult(ok=False, error="gateway_unreachable")
        try:
            parsed = json.loads(raw.decode("utf8"))
        except ValueError:
            parsed = None
        identifier = _read_id(parsed)
        return SmsResult(
            ok=True,
            provider_ref=identifier if identifier is not None else f"http:{notification_id}",
            cost_poisha=segments_for(body) * POISHA_PER_SEGMENT,
        )

    def verify_receipt(self, raw_body: str, signature: str | None) -> bool:
        if self.receipt_secret == "" or not signature:
            return False
        expected = http_receipt_signature(raw_body, self.receipt_secret)
        return hmac.compare_digest(expected.encode("utf8"), signature.encode("utf8"))

    def read_receipt(self, body: Any) -> dict[str, Any] | None:
        if not isinstance(body, dict):
            return None
        provider_ref = _read_id(body)
        status = body.get("status").strip().lower() if isinstance(body.get("status"), str) else ""
        if provider_ref is None or status == "":
            return None
        reason = body.get("reason").strip() if isinstance(body.get("reason"), str) else ""
        outcome = "delivered" if status in _DELIVERED else "failed" if status in _FAILED else "pending"
        return {"providerRef": provider_ref, "outcome": outcome, "reason": reason or None}


def http_receipt_signature(raw_body: str, secret: str) -> str:
    return hmac.new(secret.encode("utf8"), raw_body.encode("utf8"), hashlib.sha256).hexdigest()


_current: Any = None


class BridgeSmsAdapter:
    """A Node test's SMS stand-in (`adapters/bridge.py`)."""

    def __init__(self, url: str, props: dict[str, Any]) -> None:
        self.url = url
        self.name = props.get("name", "bridge")
        self.reports_delivery = props.get("reportsDelivery") is True

    def send(self, *, to: str, body: str, notification_id: str, template_key: str, sensitive: bool = False) -> SmsResult:
        from .bridge import call

        message: dict[str, Any] = {"to": to, "body": body, "notificationId": notification_id, "templateKey": template_key}
        if sensitive:
            message["sensitive"] = True
        result = call(self.url, "send", message) or {}
        return SmsResult(
            ok=bool(result.get("ok")),
            provider_ref=result.get("providerRef"),
            cost_poisha=result.get("costPoisha"),
            error=result.get("error"),
            retryable=result.get("retryable"),
        )

    def verify_receipt(self, raw_body: str, signature: str | None) -> bool:
        from .bridge import MISSING, UNDEFINED_ARG, call

        answer = call(self.url, "verifyReceipt", raw_body, UNDEFINED_ARG if signature is None else signature)
        return False if answer is MISSING or answer is None else bool(answer)

    def read_receipt(self, body: Any) -> dict[str, Any] | None:
        from .bridge import MISSING, call

        answer = call(self.url, "readReceipt", body)
        return None if answer is MISSING else answer


def sms() -> Any:
    global _current
    from .bridge import installed

    bridged = installed("sms")
    if bridged is not None:
        return BridgeSmsAdapter(bridged["url"], bridged.get("props") or {})
    if _current is None:
        provider = env().SMS_PROVIDER
        _current = LogSmsAdapter() if provider == "log" else HttpSmsAdapter() if provider == "http" else UnconfiguredSmsAdapter()
    return _current


def set_sms_adapter(adapter: Any) -> None:
    global _current
    _current = adapter


def reset_sms_adapter() -> Any:
    global _current
    _current = None
    return sms()
