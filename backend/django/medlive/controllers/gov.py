"""The national layer's endpoints (port of `controllers/gov.controller.ts`; BACKEND.md §7.7, S-B-13).

Nothing here takes a parameter: no hospital to name, no patient to ask about,
no range to widen. Aggregates are never cached: a proxy serving an hour-old
map would hand somebody an hour-old figure under a fresh page.
"""

from __future__ import annotations

from typing import Any

from ..core.http import ApiRequest, Reply, ok
from ..services import gov as gov_service


def _send(data: Any) -> Reply:
    return ok(data, headers={"Cache-Control": "no-store"})


def get_capacity(req: ApiRequest) -> Reply:
    return _send(gov_service.capacity())


def get_er_load(req: ApiRequest) -> Reply:
    return _send(gov_service.er_load())


def get_signals(req: ApiRequest) -> Reply:
    return _send(gov_service.signals())


def get_benchmarks(req: ApiRequest) -> Reply:
    return _send(gov_service.benchmarks())
