"""Nagad checkout (port of `adapters/payments/nagad.ts`).

Built against Nagad's documented checkout interface (RSA-sealed sensitive
data, signed with the merchant's key). Not activated: it needs a merchant
agreement and keys (CLAUDE.md §4.6). Refunds are made in Nagad's merchant
panel and recorded here by hand.
"""

from __future__ import annotations

import base64
import json
import math
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from ...core.env import env
from ...core.logging import logger
from ._http import send


def nagad_configured() -> bool:
    e = env()
    return all(
        v != ""
        for v in (e.NAGAD_BASE_URL, e.NAGAD_MERCHANT_ID, e.NAGAD_MERCHANT_NUMBER, e.NAGAD_PUBLIC_KEY, e.NAGAD_PRIVATE_KEY)
    )


def pem(key: str, kind: str) -> str:
    trimmed = key.strip().replace("\\n", "\n")
    if trimmed.startswith("-----BEGIN"):
        return trimmed
    body = re.sub(r"\s+", "", trimmed)
    lines = "\n".join(body[i : i + 64] for i in range(0, len(body), 64))
    return f"-----BEGIN {kind}-----\n{lines}\n-----END {kind}-----"


def nagad_date_time(at: datetime) -> str:
    dhaka = at.astimezone(timezone.utc) + timedelta(hours=6)
    return dhaka.strftime("%Y%m%d%H%M%S")


def nagad_order_id(payment_id: str) -> str:
    return payment_id.replace("-", "")


def _text(answer: dict[str, Any], key: str) -> str | None:
    value = answer.get(key)
    return value if isinstance(value, str) and value != "" else None


def _json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf8")


class NagadProvider:
    name = "nagad"
    refunds_by_api = False

    def __init__(
        self, base: str | None = None, nagad_public_key: str | None = None, merchant_private_key: str | None = None
    ) -> None:
        e = env()
        self.base = (base if base is not None else e.NAGAD_BASE_URL).rstrip("/")
        self._public: Any = serialization.load_pem_public_key(
            pem(nagad_public_key if nagad_public_key is not None else e.NAGAD_PUBLIC_KEY, "PUBLIC KEY").encode()
        )
        self._private: Any = serialization.load_pem_private_key(
            pem(merchant_private_key if merchant_private_key is not None else e.NAGAD_PRIVATE_KEY, "PRIVATE KEY").encode(),
            password=None,
        )

    def charge(self, *, payment_id: str, amount_poisha: int, idempotency_key: str, return_url: str) -> dict[str, Any]:
        e = env()
        try:
            order_id = nagad_order_id(payment_id)
            date_time = nagad_date_time(datetime.now(timezone.utc))
            opening = {
                "merchantId": e.NAGAD_MERCHANT_ID,
                "datetime": date_time,
                "orderId": order_id,
                "challenge": secrets.token_hex(20),
            }
            initialised = self._send(
                "POST",
                f"/check-out/initialize/{e.NAGAD_MERCHANT_ID}/{order_id}",
                {
                    "accountNumber": e.NAGAD_MERCHANT_NUMBER,
                    "dateTime": date_time,
                    "sensitiveData": self._seal(opening),
                    "signature": self._sign(opening),
                },
            )
            sealed = _text(initialised, "sensitiveData")
            if sealed is None:
                return {"ok": False, "error": "nagad_initialize_refused"}
            inner = self._open(sealed)
            reference = _text(inner, "paymentReferenceId")
            challenge = _text(inner, "challenge")
            if reference is None or challenge is None:
                return {"ok": False, "error": "nagad_initialize_unreadable"}
            order = {
                "merchantId": e.NAGAD_MERCHANT_ID,
                "orderId": order_id,
                "currencyCode": "050",
                "amount": f"{amount_poisha / 100:.2f}",
                "challenge": challenge,
            }
            completed = self._send(
                "POST",
                f"/check-out/complete/{reference}",
                {
                    "sensitiveData": self._seal(order),
                    "signature": self._sign(order),
                    "merchantCallbackURL": return_url,
                    "additionalMerchantInfo": {},
                },
            )
            url = _text(completed, "callBackUrl")
            if _text(completed, "status") != "Success" or url is None:
                return {"ok": False, "error": "nagad_complete_refused"}
            return {"ok": True, "checkoutId": reference, "providerRef": None, "settled": False, "redirectUrl": url}
        except Exception as error:  # noqa: BLE001
            logger.warn({"paymentId": payment_id, "err": type(error).__name__}, "nagad charge failed")
            return {"ok": False, "error": "nagad_unreachable"}

    def confirm(self, *, payment_id: str, checkout_id: str, amount_poisha: int, hint: str | None) -> dict[str, Any]:
        try:
            answer = self._send("GET", f"/verify/payment/{checkout_id}")
            status = _text(answer, "status")
            if status == "Success":
                ref = _text(answer, "issuerPaymentRefNo")
                try:
                    amount = float(answer.get("amount"))  # type: ignore[arg-type]
                except (TypeError, ValueError):
                    amount = math.nan
                if ref is None or not math.isfinite(amount):
                    return {"status": "unreachable", "error": "nagad_verify_unreadable"}
                return {"status": "paid", "providerRef": ref, "amountPoisha": math.floor(amount * 100 + 0.5)}
            if status in ("Aborted", "Cancelled"):
                return {"status": "failed", "reason": "cancelled"}
            if status in ("Failed", "Expired", "Declined"):
                return {"status": "failed", "reason": "declined"}
            return {"status": "pending"}
        except Exception as error:  # noqa: BLE001
            logger.warn({"paymentId": payment_id, "err": type(error).__name__}, "nagad verify failed")
            return {"status": "unreachable", "error": "nagad_unreachable"}

    def refund(self, **_: Any) -> dict[str, Any]:
        return {"ok": False, "error": "nagad_refund_by_merchant_panel"}

    def verify_webhook(self, raw_body: str, signature: str | None) -> bool:
        return False

    def _seal(self, value: dict[str, str]) -> str:
        return base64.b64encode(self._public.encrypt(_json(value), padding.PKCS1v15())).decode()

    def _sign(self, value: dict[str, str]) -> str:
        return base64.b64encode(self._private.sign(_json(value), padding.PKCS1v15(), hashes.SHA256())).decode()

    def _open(self, sealed: str) -> dict[str, Any]:
        plain = self._private.decrypt(base64.b64decode(sealed), padding.PKCS1v15()).decode("utf8")
        parsed = json.loads(plain)
        if not isinstance(parsed, dict):
            raise RuntimeError("nagad_sealed_unreadable")
        return parsed

    def _send(self, method: str, path: str, body: Any = None) -> dict[str, Any]:
        return send(
            method,
            f"{self.base}{path}",
            body,
            {"X-KM-Api-Version": "v-0.2.0", "X-KM-Client-Type": "PC_WEB", "X-KM-IP-V4": "127.0.0.1"},
        )
