"""Counter registration controllers (port of `controllers/registration.controller.ts`; S-B-03)."""

from __future__ import annotations

from typing import Any

from ..core.errors import auth_required, forbidden_scope
from ..core.http import ApiRequest, Reply, ok
from ..services import registration


def _actor_of(req: ApiRequest) -> dict[str, Any]:
    principal = req.principal
    if principal is None:
        raise auth_required()
    if principal.kind != "staff":
        raise forbidden_scope({"reason": "not_hospital_staff"})
    return {
        "staffId": principal.id,
        "hospitalId": principal.hospital_id,
        "ip": req.ip or None,
        "userAgent": req.get("user-agent"),
    }


def lookup(req: ApiRequest) -> Reply:
    return ok(registration.lookup(_actor_of(req), req.query["phone"]))


def register(req: ApiRequest) -> Reply:
    actor = _actor_of(req)
    return ok(registration.register(req.body, actor))
