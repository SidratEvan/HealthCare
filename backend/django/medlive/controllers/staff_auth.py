"""Staff sign-in controllers (port of `controllers/staffAuth.controller.ts`; S-B-00, FR-SEC-06)."""

from __future__ import annotations

from ..core.errors import auth_required, forbidden_scope
from ..core.http import ApiRequest, Reply, ok
from ..services import modules
from ..services import staff_auth


def _client(req: ApiRequest) -> dict[str, str | None]:
    return {"ip": req.ip or None, "userAgent": req.get("user-agent")}


def _staff_id_of(req: ApiRequest) -> str:
    principal = req.principal
    if principal is None:
        raise auth_required()
    if principal.kind not in ("staff", "national"):
        raise forbidden_scope({"reason": "staff_only"})
    return principal.id


def login(req: ApiRequest) -> Reply:
    body = req.body
    return ok(
        staff_auth.login(
            email=body["email"], password=body["password"], hospital_code=body.get("hospitalCode"), client=_client(req)
        )
    )


def refresh(req: ApiRequest) -> Reply:
    return ok(staff_auth.refresh(req.body["refresh"], _client(req)))


def logout(req: ApiRequest) -> Reply:
    staff_auth.logout(req.body["refresh"])
    return ok({"signedOut": True})


def me(req: ApiRequest) -> Reply:
    return ok(staff_auth.me(_staff_id_of(req)))


def change_password(req: ApiRequest) -> Reply:
    body = req.body
    return ok(
        staff_auth.change_password(_staff_id_of(req), current=body["current"], next_password=body["next"], client=_client(req))
    )


def second_factor(req: ApiRequest) -> Reply:
    body = req.body
    return ok(staff_auth.verify_second_factor(challenge=body["challenge"], code=body["code"], client=_client(req)))


def two_factor_setup(req: ApiRequest) -> Reply:
    return ok(staff_auth.start_two_factor_setup(_staff_id_of(req)))


def two_factor_enable(req: ApiRequest) -> Reply:
    return ok(staff_auth.enable_two_factor(_staff_id_of(req), req.body["code"], _client(req)))


def chambers(req: ApiRequest) -> Reply:
    principal = req.principal
    if principal is None:
        raise auth_required()
    if principal.kind != "staff":
        raise forbidden_scope({"reason": "no_facility"})
    return ok(
        {
            "chambers": staff_auth.chambers_for(principal, req.query_raw.get("includeEnded") == "1"),
            "modulesOff": list(modules.modules_off(principal.hospital_id or "")),
        }
    )
