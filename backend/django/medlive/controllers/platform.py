"""Platform onboarding controllers (port of `controllers/platform.controller.ts`; S-B-12, FR-ONB-*)."""

from __future__ import annotations

from typing import Any, Callable

from ..core.errors import AppError, auth_required, forbidden_scope
from ..core.http import ApiRequest, Reply, ok
from ..services import org_application as applications
from ..services import platform


def _actor_of(req: ApiRequest) -> dict[str, Any]:
    principal = req.principal
    if principal is None:
        raise auth_required()
    if principal.kind != "national":
        raise forbidden_scope({"reason": "not_platform_staff"})
    return {"staffId": principal.id, "ip": req.ip or None, "userAgent": req.get("user-agent")}


def post_application(req: ApiRequest) -> Reply:
    """Public (FR-ONB-09). Answers with the code and the email to sign in with,
    and no token: signing in is its own step with its own second factor."""
    key = req.idempotency_key
    if key is None:
        raise AppError("IDEMPOTENCY_KEY_REQUIRED")
    answer = applications.apply(body=req.body, key=key, ip=req.ip or None, user_agent=req.get("user-agent"))
    return ok(answer, status=201)


def list_workspaces(req: ApiRequest) -> Reply:
    return ok({"workspaces": platform.list_workspaces()})


def get_workspace(req: ApiRequest) -> Reply:
    return ok(platform.workspace(req.params["id"]))


def get_audit_trail(req: ApiRequest) -> Reply:
    return ok(platform.audit_trail(req.params["id"]))


def post_workspace(req: ApiRequest) -> Reply:
    return ok(platform.create_workspace(_actor_of(req), req.body), status=201)


def post_act(action: str) -> Callable[[ApiRequest], Reply]:
    """One handler per act, so each route names what it does."""

    def handler(req: ApiRequest) -> Reply:
        return ok(platform.act(_actor_of(req), req.params["id"], action, req.body.get("note")))

    handler.__name__ = f"post_{action}"
    return handler


def put_modules(req: ApiRequest) -> Reply:
    return ok(platform.set_modules(_actor_of(req), req.params["id"], req.body["off"]))


def put_agreement(req: ApiRequest) -> Reply:
    body = req.body
    return ok(platform.set_agreement(_actor_of(req), req.params["id"], body["state"], body.get("note")))


def post_portal_domain(req: ApiRequest) -> Reply:
    return ok(platform.set_portal_domain(_actor_of(req), req.params["id"], req.body["domain"]))


def post_verify_doctor(req: ApiRequest) -> Reply:
    return ok(platform.verify_doctor(_actor_of(req), req.params["id"], req.params["doctorId"]))
