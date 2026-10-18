"""Lab and pharmacy controllers (port of `controllers/lab.controller.ts`; FR-LAB-*, FR-PHA-*)."""

from __future__ import annotations

from typing import Any

from ..core.errors import forbidden_scope, not_found
from ..core.http import ApiRequest, Reply, ok, raw_reply
from ..core.schema import js_number
from ..services import lab
from ..services import pharmacy


def order(req: ApiRequest) -> Reply:
    body = req.body
    result = lab.order(
        booking_id=body["bookingId"],
        tests=body["tests"],
        idempotency_key=body.get("clientEventId") or body["idempotencyKey"],
        actor=_actor_of(req),
    )
    return ok(result, status=200 if result["duplicate"] else 201)


def advance(req: ApiRequest) -> Reply:
    return ok(lab.advance(order_id=_param(req), action=req.body["action"], actor=_actor_of(req)))


def upload_report(req: ApiRequest) -> Reply:
    body = req.body
    result = lab.upload_report(
        order_id=_param(req),
        file_type=body["fileType"],
        content=body["content"],
        idempotency_key=body.get("clientEventId") or body["idempotencyKey"],
        actor=_actor_of(req),
    )
    return ok(result, status=200 if result["duplicate"] else 201)


def queue(req: ApiRequest) -> Reply:
    query = req.query
    return ok(lab.queue(hospital_id=_hospital_param(req), state=query["state"], days=query["days"], actor=_actor_of(req)))


def patient_label(req: ApiRequest) -> Reply:
    return ok({"label": lab.patient_label(_param(req), _actor_of(req))})


def catalogue(req: ApiRequest) -> Reply:
    return ok({"tests": lab.test_catalogue()})


def shelf(req: ApiRequest) -> Reply:
    return ok(pharmacy.shelf(_hospital_param(req), _actor_of(req)))


def set_flags(req: ApiRequest) -> Reply:
    return ok(pharmacy.set_flags(hospital_id=_hospital_param(req), flags=req.body["flags"], actor=_actor_of(req)))


def search_medicines(req: ApiRequest) -> Reply:
    query = req.query
    return ok(
        pharmacy.search_medicines(
            scope=query.get("scope"),
            q=query["q"],
            lat=query.get("lat"),
            lng=query.get("lng"),
            limit=query["limit"],
        )
    )


def serve_file(req: ApiRequest) -> Reply:
    key = req.params.get("key")
    raw_expires: Any = req.query_raw.get("expires")
    signature = req.query_raw.get("sig")
    if not isinstance(key, str) or key == "" or not isinstance(signature, str):
        raise not_found("file")
    # `Number(req.query.expires)`: a repeated parameter is an array, which is NaN.
    expires = js_number(raw_expires) if not isinstance(raw_expires, list) else float("nan")
    file = lab.open_signed_file(key=key, expires=expires, signature=signature)
    if file is None:
        raise not_found("file")
    return raw_reply(file["bytes"], file["contentType"], headers={"Cache-Control": "private, no-store"})


def _param(req: ApiRequest) -> str:
    value = req.params.get("id")
    if not isinstance(value, str) or value == "":
        raise not_found("route parameter")
    return value


def _hospital_param(req: ApiRequest) -> str:
    value = req.params.get("hospitalId")
    if not isinstance(value, str) or value == "":
        raise not_found("route parameter")
    return value


def _actor_of(req: ApiRequest) -> dict[str, str]:
    principal = req.principal
    if principal is None or principal.kind != "staff":
        raise forbidden_scope({"reason": "staff_only"})
    return {"staffUserId": principal.id, "hospitalId": principal.hospital_id or ""}
