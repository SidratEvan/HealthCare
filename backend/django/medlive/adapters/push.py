"""Web Push behind an adapter (port of `adapters/push.ts`).

No adapter sends Web Push yet: messages go by SMS until one does (FR-NOT-02).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..core.env import env
from ..core.logging import logger


@dataclass(frozen=True)
class PushResult:
    ok: bool
    provider_ref: str | None = None
    delivered: int = 0
    error: str | None = None


def push_configured() -> bool:
    return env().VAPID_PUBLIC_KEY != "" and env().VAPID_PRIVATE_KEY != ""


class UnconfiguredPushAdapter:
    name = "unconfigured"

    def send(self, *, tokens: list[str], body: str, notification_id: str, template_key: str, url: str | None) -> PushResult:
        logger.debug(
            {"notificationId": notification_id, "templateKey": template_key, "channel": "push", "tokens": len(tokens)},
            "push not dispatched",
        )
        return PushResult(ok=False, error="no_device_token" if not tokens else "push_not_configured")


_current: Any = None


def push() -> Any:
    global _current
    if _current is None:
        _current = UnconfiguredPushAdapter()
    return _current


def set_push_adapter(adapter: Any) -> None:
    global _current
    _current = adapter


def reset_push_adapter() -> Any:
    global _current
    _current = None
    return push()
