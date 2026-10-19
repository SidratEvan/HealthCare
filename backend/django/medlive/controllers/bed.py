"""Ward board controllers (port of `controllers/bed.controller.ts`; FR-BED-*, S-B-06)."""

from __future__ import annotations

from typing import Any

from ..core.errors import forbidden_scope, not_found
from ..core.http import ApiRequest, Reply, ok
from ..services import bed as beds
from ..services import patient_auth


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


def _required_patient(patient: dict[str, Any] | None) -> dict[str, Any]:
    if patient is None:
        raise not_found("patient")
    return patient


def get_board(req: ApiRequest) -> Reply:
    return ok(beds.board(_param(req, "id")))


def get_bed(req: ApiRequest) -> Reply:
    return ok(beds.panel(_param(req, "id"), _actor_of(req)))


def admit(req: ApiRequest) -> Reply:
    body = req.body
    if body["bedRequestId"] is not None:
        who: dict[str, Any] = {"kind": "request", "bedRequestId": body["bedRequestId"]}
    elif body["emergencyCaseId"] is not None:
        who = {"kind": "emergency", "emergencyCaseId": body["emergencyCaseId"], **_required_patient(body["patient"])}
    else:
        who = {"kind": "patient", **_required_patient(body["patient"])}
    return ok(
        beds.admit(
            {
                "bedId": _param(req, "id"),
                "who": who,
                "expectedDischargeDate": body["expectedDischargeDate"],
                **_envelope(body),
            },
            _actor_of(req),
        )
    )


def discharge(req: ApiRequest) -> Reply:
    return ok(beds.discharge({"bedId": _param(req, "id"), **_envelope(req.body)}, _actor_of(req)))


def transfer(req: ApiRequest) -> Reply:
    body = req.body
    return ok(beds.transfer({"bedId": _param(req, "id"), "toBedId": body["toBedId"], **_envelope(body)}, _actor_of(req)))


def reserve(req: ApiRequest) -> Reply:
    body = req.body
    return ok(beds.reserve({"bedId": _param(req, "id"), "minutes": body["minutes"], **_envelope(body)}, _actor_of(req)))


def release(req: ApiRequest) -> Reply:
    return ok(beds.release({"bedId": _param(req, "id"), **_envelope(req.body)}, _actor_of(req)))


def clean_start(req: ApiRequest) -> Reply:
    return ok(beds.clean_start({"bedId": _param(req, "id"), **_envelope(req.body)}, _actor_of(req)))


def clean_done(req: ApiRequest) -> Reply:
    return ok(beds.clean_done({"bedId": _param(req, "id"), **_envelope(req.body)}, _actor_of(req)))


def out_of_service(req: ApiRequest) -> Reply:
    body = req.body
    return ok(
        beds.out_of_service({"bedId": _param(req, "id"), "reason": body["reason"], **_envelope(body)}, _actor_of(req))
    )


def restore(req: ApiRequest) -> Reply:
    return ok(beds.restore({"bedId": _param(req, "id"), **_envelope(req.body)}, _actor_of(req)))


def forecast_discharge(req: ApiRequest) -> Reply:
    body = req.body
    return ok(
        beds.forecast_discharge({"bedId": _param(req, "id"), "date": body["date"], **_envelope(body)}, _actor_of(req))
    )


def create_request(req: ApiRequest) -> Reply:
    body = req.body
    patient_auth.assert_guest_phone_proven(req.principal, body["patient"]["phone"])
    created = beds.create_request(
        hospital_id=body["hospitalId"],
        bed_kind=body["bedKind"],
        patient=body["patient"],
        note=body["note"],
        expected_arrival_at=body["expectedArrivalAt"],
        idempotency_key=req.idempotency_key,
    )
    return ok(created, status=200 if created["duplicate"] else 201)


def track_request(req: ApiRequest) -> Reply:
    return ok(beds.track_request(_param(req, "token")))


def pending_requests(req: ApiRequest) -> Reply:
    return ok(beds.pending(_param(req, "id"), _actor_of(req)))


def respond(req: ApiRequest) -> Reply:
    body = req.body
    common = _envelope(body)
    if body["action"] == "hold":
        input: dict[str, Any] = {"action": "hold", "bedId": body["bedId"], "minutes": body["minutes"], **common}
    elif body["action"] == "confirm":
        input = {"action": "confirm", "bedId": body["bedId"], **common}
    else:
        input = {"action": "decline", **common}
    return ok(beds.respond(_param(req, "id"), input, _actor_of(req)))
