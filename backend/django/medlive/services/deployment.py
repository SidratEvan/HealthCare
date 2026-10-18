"""What this deployment offers, as the apps are told (port of `services/deployment.service.ts`)."""

from __future__ import annotations

from typing import Any

from ..adapters.payments import available_methods
from ..core.env import env


def guest_phone_check_required() -> bool:
    """Whether a guest booking must prove its phone first (FR-GST-03): on, except on a demonstration."""
    e = env()
    return e.GUEST_BOOKING_OTP if e.GUEST_BOOKING_OTP is not None else not e.DEMO_MODE


def online_payments_available() -> bool:
    return len(available_methods()) > 0


def method_available(method: str) -> bool:
    return method in ("at_hospital", "cash") or method in available_methods()


def public_config() -> dict[str, Any]:
    return {
        "demo": env().DEMO_MODE,
        "onlinePayments": online_payments_available(),
        "paymentMethods": available_methods(),
        "guestPhoneCheck": guest_phone_check_required(),
    }
