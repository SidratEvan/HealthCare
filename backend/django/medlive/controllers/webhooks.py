"""Provider callbacks (port of `controllers/webhooks.controller.ts`; FR-PAY-03, FR-NOT-06).

Each is checked by its signature over the exact bytes received before
anything in it is believed.
"""

from __future__ import annotations

import json
from typing import Any, Callable

from ..core.http import ApiRequest, Reply, json_reply, ok
from ..core.logging import logger
from ..core.schema import js_length, js_trim
from ..services import notification as notifications
from ..services import payment as payment_service

PAID_STATUSES = {"success", "completed", "paid", "settled"}


def _refused() -> Reply:
    return json_reply(
        {"ok": False, "error": {"code": "AUTH_TOKEN_INVALID", "message": "Signature is not valid."}}, status=401
    )


def _unrecognised(what: str) -> Reply:
    return json_reply({"ok": False, "error": {"code": "VALIDATION_FAILED", "message": f"Unrecognised {what} body."}}, status=400)


def callback(provider_name: str) -> Callable[[ApiRequest], Reply]:
    def handle(req: ApiRequest) -> Reply:
        raw = req.raw_body or ""
        if not payment_service.verify_provider_signature(raw, req.get("x-signature")):
            logger.warn({"provider": provider_name}, "webhook signature rejected")
            return _refused()
        body = _safe_json(raw)
        provider_ref = _read_string(body, "providerRef")
        status = _read_string(body, "status")
        if provider_ref is None or status is None:
            return _unrecognised("callback")
        result = payment_service.apply_provider_callback(provider_ref=provider_ref, paid=status.lower() in PAID_STATUSES)
        return ok({"applied": result["applied"]})

    return handle


def sms_delivery(req: ApiRequest) -> Reply:
    raw = req.raw_body or ""
    if not notifications.verify_receipt_signature(raw, req.get("x-signature")):
        logger.warn({"provider": "sms"}, "delivery receipt signature rejected")
        return _refused()
    result = notifications.apply_delivery_receipt(_safe_json(raw))
    if not result["recognised"]:
        return _unrecognised("receipt")
    return ok({"applied": result["applied"]})


def _safe_json(raw: str) -> Any:
    try:
        return json.loads(raw)
    except ValueError:
        return None


def _read_string(body: Any, key: str) -> str | None:
    if not isinstance(body, dict):
        return None
    value = body.get(key)
    if not isinstance(value, str):
        return None
    trimmed = js_trim(value)
    return None if trimmed == "" or js_length(trimmed) > 200 else trimmed
