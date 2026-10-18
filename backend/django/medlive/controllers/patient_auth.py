"""Patient sign-in controllers (port of `controllers/patientAuth.controller.ts`; FR-PAT-01, FR-GST-03)."""

from __future__ import annotations

from ..core.errors import auth_required, forbidden_scope
from ..core.http import ApiRequest, Reply, ok
from ..services import patient_auth


def _client(req: ApiRequest) -> dict[str, str | None]:
    return patient_auth.client_of(req.ip or None, req.get("user-agent"))


def _user_id_of(req: ApiRequest) -> str:
    principal = req.principal
    if principal is None:
        raise auth_required()
    if principal.kind != "patient":
        raise forbidden_scope({"reason": "account_only"})
    return principal.id


def request_code(req: ApiRequest) -> Reply:
    return ok(patient_auth.request_code(req.body["phone"], _client(req)))


def verify(req: ApiRequest) -> Reply:
    return ok(patient_auth.verify(req.body["phone"], req.body["code"], _client(req)))


def refresh(req: ApiRequest) -> Reply:
    return ok(patient_auth.refresh(req.body["refresh"], _client(req)))


def logout(req: ApiRequest) -> Reply:
    patient_auth.logout(req.body["refresh"])
    return ok({"signedOut": True})


def profiles(req: ApiRequest) -> Reply:
    return ok({"profiles": patient_auth.profiles(_user_id_of(req))})


def claim(req: ApiRequest) -> Reply:
    return ok(patient_auth.claim(_user_id_of(req), req.body["confirm"]))


def start_guest(req: ApiRequest) -> Reply:
    body = req.body
    return ok(patient_auth.start_guest(body["phone"], body["name"], _client(req), body.get("deviceProof")))


def verify_guest(req: ApiRequest) -> Reply:
    body = req.body
    return ok(patient_auth.verify_guest(body["phone"], body["code"], body["name"], _client(req)))
