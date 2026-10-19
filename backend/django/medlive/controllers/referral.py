"""Referral controllers (port of `controllers/referral.controller.ts`; FR-EMG-07..09)."""

from __future__ import annotations

from ..core.errors import forbidden_scope, not_found
from ..core.http import ApiRequest, Reply, ok
from ..services import referral as referrals


def _param(req: ApiRequest) -> str:
    value = req.params.get("id")
    if not isinstance(value, str) or value == "":
        raise not_found("route parameter")
    return value


def _actor_of(req: ApiRequest) -> dict[str, str]:
    principal = req.principal
    if principal is None or principal.kind != "staff":
        raise forbidden_scope({"reason": "staff_only"})
    return {"staffUserId": principal.id, "hospitalId": principal.hospital_id}


def send(req: ApiRequest) -> Reply:
    body = req.body
    result = referrals.send(
        emergency_case_id=body["emergencyCaseId"],
        to_hospital_id=body["toHospitalId"],
        required_capability=body["requiredCapability"],
        required_bed_kind=body["requiredBedKind"],
        note=body["note"],
        # A console's offline send carries its own id; a browser the header.
        idempotency_key=body.get("clientEventId") or req.idempotency_key,
        actor=_actor_of(req),
    )
    return ok(result, status=200 if result["duplicate"] else 201)


def seen(req: ApiRequest) -> Reply:
    return ok(referrals.seen(_param(req), _actor_of(req)))


def accept(req: ApiRequest) -> Reply:
    return ok(referrals.accept(_param(req), _actor_of(req)))


def decline(req: ApiRequest) -> Reply:
    return ok(referrals.decline(_param(req), req.body["reason"], _actor_of(req)))


def cancel(req: ApiRequest) -> Reply:
    return ok(referrals.cancel(_param(req), _actor_of(req)))


def arrive(req: ApiRequest) -> Reply:
    return ok(referrals.arrive(_param(req), _actor_of(req)))
