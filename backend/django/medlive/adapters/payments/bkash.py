"""bKash tokenized checkout (port of `adapters/payments/bkash.ts`).

Built against bKash's documented tokenized-checkout interface. Not activated:
it runs only with `PAYMENT_PROVIDER=live` and all five credentials set, which
needs a merchant agreement (CLAUDE.md §4.6).
"""

from __future__ import annotations

import math
import threading
import time
from typing import Any

from ...core.env import env
from ...core.logging import logger
from ._http import send


def bkash_configured() -> bool:
    e = env()
    return all(v != "" for v in (e.BKASH_BASE_URL, e.BKASH_APP_KEY, e.BKASH_APP_SECRET, e.BKASH_USERNAME, e.BKASH_PASSWORD))


def bkash_amount(poisha: int) -> str:
    return f"{poisha / 100:.2f}"


def _poisha_of(amount: Any) -> float:
    if isinstance(amount, bool) or not isinstance(amount, (str, int, float)):
        return math.nan
    try:
        value = float(amount)
    except ValueError:
        return math.nan
    return math.floor(value * 100 + 0.5) if math.isfinite(value) else math.nan


def _text(answer: dict[str, Any], key: str) -> str | None:
    value = answer.get(key)
    return value if isinstance(value, str) and value != "" else None


class BkashProvider:
    name = "bkash"
    refunds_by_api = True

    def __init__(self, base: str | None = None) -> None:
        self.base = (base if base is not None else env().BKASH_BASE_URL).rstrip("/")
        self._token: dict[str, Any] | None = None
        self._lock = threading.Lock()

    def charge(self, *, payment_id: str, amount_poisha: int, idempotency_key: str, return_url: str) -> dict[str, Any]:
        try:
            answer = self._call(
                "/tokenized/checkout/create",
                {
                    "mode": "0011",
                    "payerReference": payment_id,
                    "callbackURL": return_url,
                    "amount": bkash_amount(amount_poisha),
                    "currency": "BDT",
                    "intent": "sale",
                    "merchantInvoiceNumber": payment_id,
                },
            )
            checkout = _text(answer, "paymentID")
            url = _text(answer, "bkashURL")
            if _text(answer, "statusCode") != "0000" or checkout is None or url is None:
                return {"ok": False, "error": f"bkash_create_{_text(answer, 'statusCode') or 'unreadable'}"}
            return {"ok": True, "checkoutId": checkout, "providerRef": None, "settled": False, "redirectUrl": url}
        except Exception as error:  # noqa: BLE001
            logger.warn({"paymentId": payment_id, "err": type(error).__name__}, "bkash create failed")
            return {"ok": False, "error": "bkash_unreachable"}

    def confirm(self, *, payment_id: str, checkout_id: str, amount_poisha: int, hint: str | None) -> dict[str, Any]:
        try:
            if hint is None or hint == "success":
                read = self._read(self._call("/tokenized/checkout/execute", {"paymentID": checkout_id}))
                if read is not None and read["status"] != "pending":
                    return read
            status = self._call("/tokenized/checkout/payment/status", {"paymentID": checkout_id})
            return self._read(status) or {"status": "unreachable", "error": "bkash_status_unreadable"}
        except Exception as error:  # noqa: BLE001
            logger.warn({"paymentId": payment_id, "err": type(error).__name__}, "bkash confirm failed")
            return {"status": "unreachable", "error": "bkash_unreachable"}

    def refund(
        self,
        *,
        payment_id: str,
        checkout_id: str | None,
        provider_ref: str | None,
        amount_poisha: int,
        reason: str,
        **_: Any,
    ) -> dict[str, Any]:
        if checkout_id is None or provider_ref is None:
            return {"ok": False, "error": "bkash_refund_without_references"}
        try:
            answer = self._call(
                "/tokenized/checkout/payment/refund",
                {
                    "paymentID": checkout_id,
                    "trxID": provider_ref,
                    "amount": bkash_amount(amount_poisha),
                    "sku": "serial",
                    "reason": reason[:255],
                },
            )
            refund_ref = _text(answer, "refundTrxID")
            if _text(answer, "transactionStatus") != "Completed" or refund_ref is None:
                return {"ok": False, "error": f"bkash_refund_{_text(answer, 'statusCode') or 'refused'}"}
            return {"ok": True, "providerRef": refund_ref}
        except Exception as error:  # noqa: BLE001
            logger.warn({"paymentId": payment_id, "err": type(error).__name__}, "bkash refund failed")
            return {"ok": False, "error": "bkash_unreachable"}

    def verify_webhook(self, raw_body: str, signature: str | None) -> bool:
        return False

    def _read(self, answer: dict[str, Any]) -> dict[str, Any] | None:
        status = _text(answer, "transactionStatus")
        if status == "Completed":
            ref = _text(answer, "trxID")
            amount = _poisha_of(answer.get("amount"))
            if ref is None or math.isnan(amount):
                return None
            return {"status": "paid", "providerRef": ref, "amountPoisha": int(amount)}
        if status in ("Initiated", "Pending Authorized"):
            return {"status": "pending"}
        if status == "Cancelled":
            return {"status": "failed", "reason": "cancelled"}
        if status in ("Failed", "Expired", "Declined"):
            return {"status": "failed", "reason": "declined"}
        return None

    def _call(self, path: str, body: dict[str, str]) -> dict[str, Any]:
        token = self._id_token()
        return send("POST", f"{self.base}{path}", body, {"Authorization": token, "X-APP-Key": env().BKASH_APP_KEY})

    def _id_token(self) -> str:
        e = env()
        with self._lock:
            now = time.time() * 1000
            if self._token is not None and now < self._token["renewAt"]:
                return self._token["idToken"]
            credentials = {"username": e.BKASH_USERNAME, "password": e.BKASH_PASSWORD}
            if self._token is None:
                answer = send(
                    "POST",
                    f"{self.base}/tokenized/checkout/token/grant",
                    {"app_key": e.BKASH_APP_KEY, "app_secret": e.BKASH_APP_SECRET},
                    credentials,
                )
            else:
                answer = send(
                    "POST",
                    f"{self.base}/tokenized/checkout/token/refresh",
                    {
                        "app_key": e.BKASH_APP_KEY,
                        "app_secret": e.BKASH_APP_SECRET,
                        "refresh_token": self._token["refreshToken"],
                    },
                    credentials,
                )
            id_token = _text(answer, "id_token")
            refresh = _text(answer, "refresh_token")
            if id_token is None or refresh is None:
                self._token = None
                raise RuntimeError("bkash_token_refused")
            life = answer.get("expires_in") if isinstance(answer.get("expires_in"), (int, float)) else 3600
            self._token = {"idToken": id_token, "refreshToken": refresh, "renewAt": now + max(60, life - 300) * 1000}
            return id_token
