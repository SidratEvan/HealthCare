"""Payment providers behind one interface (port of `adapters/payments/index.ts`; FR-PAY-*).

`PAYMENT_PROVIDER=mock` is what the demonstration runs on; `live` uses bKash
and Nagad where their credentials are configured (built against their
documented interfaces, not activated with any merchant account); `off` takes
payment at the hospital only.
"""

from __future__ import annotations

import hashlib
import hmac
import threading
import uuid
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

from ...core.env import env
from ...core.logging import logger

ONLINE_METHODS = ("bkash", "nagad", "card")


def is_online(method: str) -> bool:
    return method in ONLINE_METHODS


class MockPaymentProvider:
    name = "mock"
    refunds_by_api = True

    def __init__(self, flow: str | None = None) -> None:
        self.flow = flow if flow is not None else env().MOCK_PAYMENT_FLOW
        self._charged: dict[str, str] = {}
        self._attempts: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def charge(self, *, payment_id: str, amount_poisha: int, idempotency_key: str, return_url: str) -> dict[str, Any]:
        with self._lock:
            existing = self._charged.get(idempotency_key)
            checkout_id = existing if existing is not None else f"mock_{uuid.uuid4()}"
            self._charged[idempotency_key] = checkout_id
        logger.info(
            {"paymentId": payment_id, "amountPoisha": amount_poisha, "provider": "mock"},
            "payment charged" if existing is None else "payment charge replayed",
        )
        if self.flow == "inline":
            return {"ok": True, "checkoutId": checkout_id, "providerRef": checkout_id, "settled": True, "redirectUrl": None}
        with self._lock:
            if checkout_id not in self._attempts:
                self._attempts[checkout_id] = {"outcome": "initiated", "amountPoisha": amount_poisha, "returnUrl": return_url}
        return {
            "ok": True,
            "checkoutId": checkout_id,
            "providerRef": None,
            "settled": False,
            "redirectUrl": urljoin(env().API_BASE_URL, f"/api/v1/mock-pay/{checkout_id}"),
        }

    def confirm(self, *, payment_id: str, checkout_id: str, amount_poisha: int, hint: str | None) -> dict[str, Any]:
        with self._lock:
            attempt = self._attempts.get(checkout_id)
        if attempt is None:
            if self.flow == "inline" and checkout_id.startswith("mock_"):
                return {"status": "paid", "providerRef": checkout_id, "amountPoisha": amount_poisha}
            return {"status": "failed", "reason": "declined"}
        outcome = attempt["outcome"]
        if outcome == "paid":
            return {"status": "paid", "providerRef": f"mock_trx_{checkout_id[5:]}", "amountPoisha": attempt["amountPoisha"]}
        if outcome == "failed":
            return {"status": "failed", "reason": "declined"}
        if outcome == "cancelled":
            return {"status": "failed", "reason": "cancelled"}
        return {"status": "pending"}

    def refund(self, *, payment_id: str, amount_poisha: int, **_: Any) -> dict[str, Any]:
        logger.info({"paymentId": payment_id, "amountPoisha": amount_poisha, "provider": "mock"}, "payment refunded")
        return {"ok": True, "providerRef": f"mock_refund_{uuid.uuid4()}"}

    def attempt(self, checkout_id: str) -> dict[str, Any] | None:
        with self._lock:
            found = self._attempts.get(checkout_id)
        return None if found is None else {"amountPoisha": found["amountPoisha"], "outcome": found["outcome"]}

    def settle(self, checkout_id: str, outcome: str) -> str | None:
        with self._lock:
            found = self._attempts.get(checkout_id)
            if found is None:
                return None
            if found["outcome"] == "initiated":
                found["outcome"] = outcome
            return_url = found["returnUrl"]
        status = "success" if outcome == "paid" else "failure" if outcome == "failed" else "cancel"
        parts = urlsplit(return_url)
        query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != "status"]
        query.append(("status", status))
        return urlunsplit((parts.scheme, parts.netloc, parts.path or "/", urlencode(query), parts.fragment))

    def verify_webhook(self, raw_body: str, signature: str | None) -> bool:
        if not signature:
            return False
        return hmac.compare_digest(mock_webhook_signature(raw_body).encode("utf8"), signature.encode("utf8"))


def mock_webhook_signature(raw_body: str) -> str:
    return hmac.new(env().JWT_ACCESS_SECRET.encode("utf8"), raw_body.encode("utf8"), hashlib.sha256).hexdigest()


class UnconfiguredPaymentProvider:
    name = "unconfigured"
    refunds_by_api = False

    def charge(self, **_: Any) -> dict[str, Any]:
        return {"ok": False, "error": "no_payment_provider_configured"}

    def confirm(self, **_: Any) -> dict[str, Any]:
        return {"status": "unreachable", "error": "no_payment_provider_configured"}

    def refund(self, **_: Any) -> dict[str, Any]:
        return {"ok": False, "error": "no_payment_provider_configured"}

    def verify_webhook(self, raw_body: str, signature: str | None) -> bool:
        return False


_lock = threading.Lock()
_override: Any = None
_mock: MockPaymentProvider | None = None
_bkash: Any = None
_nagad: Any = None


def mock_provider() -> MockPaymentProvider:
    global _mock
    with _lock:
        if _mock is None:
            _mock = MockPaymentProvider()
        return _mock


class BridgePaymentProvider:
    """A Node test's payment stand-in (`adapters/bridge.py`)."""

    def __init__(self, url: str, props: dict[str, Any]) -> None:
        self.url = url
        self.name = props.get("name", "bridge")
        self.refunds_by_api = props.get("refundsByApi") is True

    def _call(self, method: str, *args: Any) -> Any:
        from ..bridge import MISSING, call

        answer = call(self.url, method, *args)
        if answer is MISSING:
            raise RuntimeError(f"the test's payment provider has no {method}")
        return answer

    def charge(self, *, payment_id: str, amount_poisha: int, idempotency_key: str, return_url: str) -> dict[str, Any]:
        return self._call(
            "charge",
            {"paymentId": payment_id, "amountPoisha": amount_poisha, "idempotencyKey": idempotency_key, "returnUrl": return_url},
        )

    def confirm(self, *, payment_id: str, checkout_id: str, amount_poisha: int, hint: str | None) -> dict[str, Any]:
        return self._call(
            "confirm", {"paymentId": payment_id, "checkoutId": checkout_id, "amountPoisha": amount_poisha, "hint": hint}
        )

    def refund(self, **kw: Any) -> dict[str, Any]:
        return self._call(
            "refund",
            {
                "paymentId": kw.get("payment_id"),
                "checkoutId": kw.get("checkout_id"),
                "providerRef": kw.get("provider_ref"),
                "amountPoisha": kw.get("amount_poisha"),
                "idempotencyKey": kw.get("idempotency_key"),
                "reason": kw.get("reason"),
            },
        )

    def verify_webhook(self, raw_body: str, signature: str | None) -> bool:
        from ..bridge import MISSING, UNDEFINED_ARG, call

        answer = call(self.url, "verifyWebhook", raw_body, UNDEFINED_ARG if signature is None else signature)
        return answer is not MISSING and answer is True


def _bridged() -> Any:
    from ..bridge import installed

    spec = installed("payments")
    return None if spec is None else BridgePaymentProvider(spec["url"], spec.get("props") or {})


def provider_for(method: str) -> Any:
    global _bkash, _nagad
    if not is_online(method):
        return None
    bridged = _bridged()
    if bridged is not None:
        return bridged
    if _override is not None:
        return _override
    provider = env().PAYMENT_PROVIDER
    if provider == "mock":
        return mock_provider()
    if provider == "live":
        from .bkash import BkashProvider, bkash_configured
        from .nagad import NagadProvider, nagad_configured

        if method == "bkash" and bkash_configured():
            with _lock:
                _bkash = _bkash or BkashProvider()
                return _bkash
        if method == "nagad" and nagad_configured():
            with _lock:
                _nagad = _nagad or NagadProvider()
                return _nagad
        return None
    return None


def available_methods() -> list[str]:
    return [method for method in ONLINE_METHODS if provider_for(method) is not None]


def payments() -> Any:
    bridged = _bridged()
    if bridged is not None:
        return bridged
    if _override is not None:
        return _override
    return mock_provider() if env().PAYMENT_PROVIDER == "mock" else UnconfiguredPaymentProvider()


def set_payment_provider(provider: Any) -> None:
    global _override
    _override = provider


def reset_payment_provider() -> Any:
    global _override, _mock, _bkash, _nagad
    _override = _mock = _bkash = _nagad = None
    return payments()
