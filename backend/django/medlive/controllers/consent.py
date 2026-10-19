"""Consent controllers (port of `controllers/consent.controller.ts`; FR-PAT-63, FR-PAT-64)."""

from __future__ import annotations

from typing import Any

from ..core.errors import auth_required
from ..core.http import ApiRequest, Reply, ok
from ..services import consent


def _principal_of(req: ApiRequest) -> Any:
    principal = req.principal
    if principal is None:
        raise auth_required()
    return principal


def offer_consent(req: ApiRequest) -> Reply:
    principal = _principal_of(req)
    return ok(consent.offer_consent(principal=principal, patient_id=req.params["id"]))


def redeem_consent(req: ApiRequest) -> Reply:
    principal = _principal_of(req)
    return ok(consent.redeem_consent(principal=principal, code=req.body["code"]), status=201)


def create_consent(req: ApiRequest) -> Reply:
    principal = _principal_of(req)
    body = req.body
    return ok(
        consent.grant_direct(principal=principal, hospital_id=body["hospitalId"], scope=body["scope"]), status=201
    )


def revoke_consent(req: ApiRequest) -> Reply:
    principal = _principal_of(req)
    consent.revoke_consent(principal=principal, consent_id=req.params["id"])
    return ok({"revoked": True})


def get_access(req: ApiRequest) -> Reply:
    principal = _principal_of(req)
    patient_id = req.params["id"]
    consents = consent.list_consents(principal=principal, patient_id=patient_id)
    views = consent.access_log(principal=principal, patient_id=patient_id)
    return ok({"consents": consents, "views": views})
