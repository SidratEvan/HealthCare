"""Emergency controllers (port of `controllers/emergency.controller.ts`; FR-ER-*, S-B-07)."""

from __future__ import annotations

from typing import Any

from ..core.errors import forbidden_scope, not_found
from ..core.http import ApiRequest, Reply, ok
from ..services import emergency


def _param(req: ApiRequest, name: str) -> str:
    value = req.params.get(name)
    if not isinstance(value, str) or value == "":
        raise not_found("route parameter")
    return value


def _envelope(body: Any) -> dict[str, Any]:
    fields = body if isinstance(body, dict) else {}
    return {"clientEventId": fields.get("clientEventId"), "clientTs": fields.get("clientTs")}


def _actor_of(req: ApiRequest) -> dict[str, str]:
    principal = req.principal
    if principal is None or principal.kind != "staff":
        raise forbidden_scope({"reason": "staff_only"})
    return {"staffUserId": principal.id, "hospitalId": principal.hospital_id}


def search(req: ApiRequest) -> Reply:
    return ok(emergency.search(req.query))


def inbound(req: ApiRequest) -> Reply:
    body = req.body
    result = emergency.inbound(
        hospital_id=body["hospitalId"],
        problem=body["problem"],
        lat=body["lat"],
        lng=body["lng"],
        phone=body["phone"],
        age_years=body["ageYears"],
        sex=body["sex"],
        idempotency_key=req.idempotency_key,
    )
    return ok(result, status=200 if result["duplicate"] else 201)


def track(req: ApiRequest) -> Reply:
    return ok(emergency.track(_param(req, "token")))


def cancel(req: ApiRequest) -> Reply:
    return ok(emergency.cancel_by_family(_param(req, "token")))


def board(req: ApiRequest) -> Reply:
    return ok(emergency.board(_param(req, "id")))


def contact(req: ApiRequest) -> Reply:
    return ok(emergency.contact(_param(req, "id"), _actor_of(req)))


def walk_in(req: ApiRequest) -> Reply:
    body = req.body
    result = emergency.walk_in(
        problem=body["problem"],
        triage=body["triage"],
        phone=body["phone"],
        age_years=body["ageYears"],
        sex=body["sex"],
        idempotency_key=body.get("clientEventId") or req.idempotency_key,
        actor=_actor_of(req),
    )
    return ok(result, status=200 if result["duplicate"] else 201)


def acknowledge(req: ApiRequest) -> Reply:
    return ok(emergency.acknowledge(_param(req, "id"), _envelope(req.body), _actor_of(req)))


def update(req: ApiRequest) -> Reply:
    body = req.body
    action = body["action"]
    if action == "decline":
        command: dict[str, Any] = {"action": "decline", "reason": body["reason"]}
    elif action == "triage":
        command = {"action": "triage", "triage": body["triage"]}
    elif action == "handoff":
        command = {"action": "handoff", "bedKind": body["bedKind"]}
    else:
        command = {"action": action}
    return ok(emergency.command(_param(req, "id"), command, _envelope(body), _actor_of(req)))


def capabilities(req: ApiRequest) -> Reply:
    return ok(emergency.confirm_capabilities(_param(req, "id"), req.body["capabilities"], _actor_of(req)))
