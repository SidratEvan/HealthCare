"""Standby list controllers (port of `controllers/standby.controller.ts`; FR-QUE-30, FR-PAT-35)."""

from __future__ import annotations

from ..core.errors import not_found
from ..core.http import ApiRequest, Reply, ok
from ..services import patient_auth
from ..services import standby


def join(req: ApiRequest) -> Reply:
    body = req.body
    patient_auth.assert_guest_phone_proven(req.principal, body["guest"]["phone"])
    joined = standby.join(
        session_id=_param(req, "id"),
        guest=body["guest"],
        prepay=body["prepay"],
        client_event_id=body.get("clientEventId") or req.idempotency_key,
    )
    return ok(joined, status=200 if joined["duplicate"] else 201)


def status(req: ApiRequest) -> Reply:
    return ok(standby.status(_param(req, "token")))


def accept(req: ApiRequest) -> Reply:
    body = req.body
    return ok(standby.accept(_param(req, "token"), method=body["method"], client_event_id=body.get("clientEventId")))


def decline(req: ApiRequest) -> Reply:
    standby.decline(_param(req, "token"))
    return ok({"declined": True})


def leave(req: ApiRequest) -> Reply:
    return ok(standby.leave(_param(req, "token")))


def _param(req: ApiRequest, name: str) -> str:
    value = req.params.get(name)
    if not isinstance(value, str) or value == "":
        raise not_found("route parameter")
    return value
