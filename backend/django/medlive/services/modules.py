"""Which modules a hospital runs (port of `services/modules.service.ts`, `FR-BRD-11`)."""

from __future__ import annotations

import threading
import time

from ..core.errors import AppError
from ..domain.modules import is_hospital_module
from ..repositories import hospital_settings as settings_repo

REMEMBER_SECONDS = 30.0

_lock = threading.Lock()
_remembered: dict[str, tuple[tuple[str, ...], float]] = {}


def modules_off(hospital_id: str) -> tuple[str, ...]:
    """The modules a hospital has switched off; remembered for half a minute."""
    with _lock:
        kept = _remembered.get(hospital_id)
    if kept is not None and time.monotonic() - kept[1] < REMEMBER_SECONDS:
        return kept[0]
    off = tuple(m for m in settings_repo.modules_off(hospital_id) if is_hospital_module(m))
    with _lock:
        _remembered[hospital_id] = (off, time.monotonic())
    return off


def forget_modules(hospital_id: str | None = None) -> None:
    """After a change: forget, and close the hospital's sockets so they rejoin."""
    with _lock:
        if hospital_id is None:
            _remembered.clear()
            return
        _remembered.pop(hospital_id, None)
    from ..realtime.auth import drop_hospital_sockets

    drop_hospital_sockets(hospital_id)


def first_off(hospital_id: str, needed: tuple[str, ...] | list[str]) -> str | None:
    if not needed:
        return None
    off = modules_off(hospital_id)
    for module in needed:
        if module in off:
            return module
    return None


def require_on(hospital_id: str, module: str) -> None:
    if first_off(hospital_id, [module]) is not None:
        raise AppError("MODULE_OFF", details={"module": module})
