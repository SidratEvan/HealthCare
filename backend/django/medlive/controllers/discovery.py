"""Public discovery (port of `controllers/discovery.controller.ts`). No account needed (GR-08)."""

from __future__ import annotations

from ..core.env import env
from ..core.errors import not_found
from ..core.http import ApiRequest, Reply, ok, raw_reply
from ..services import deployment
from ..services import discovery
from ..services import portal as portals


def list_hospitals(req: ApiRequest) -> Reply:
    result = discovery.search_hospitals(req.query)
    return ok({"hospitals": result["items"], "asOf": result["asOf"]})


def search(req: ApiRequest) -> Reply:
    return ok(discovery.search(req.query))


def get_hospital(req: ApiRequest) -> Reply:
    return ok(discovery.hospital_detail(req.params["id"]))


def get_hospital_doctors(req: ApiRequest) -> Reply:
    specialty = req.query_raw.get("specialty")
    result = discovery.doctors_at(req.params["id"], specialty if isinstance(specialty, str) else None)
    return ok({"doctors": result["items"], "asOf": result["asOf"]})


def list_doctors(req: ApiRequest) -> Reply:
    return ok({"doctors": discovery.search_doctors(req.query)})


def get_doctor(req: ApiRequest) -> Reply:
    return ok(discovery.doctor_detail(req.params["id"]))


def list_sessions(req: ApiRequest) -> Reply:
    return ok({"sessions": discovery.sessions_for(req.query)})


def get_availability(req: ApiRequest) -> Reply:
    return ok(discovery.availability(req.params["id"]))


def get_config(req: ApiRequest) -> Reply:
    """What this deployment offers, and whose address the app was opened at (FR-BRD-07)."""
    scope = req.query.get("scope")
    host = req.query.get("host")
    address = None if host is None else portals.address_of(host)
    at_portal = address.code if address is not None and address.kind == "portal" else None
    code = at_portal if at_portal is not None else scope
    scoped = None if code is None else discovery.scope_info(code)
    data = {**deployment.public_config(), "address": "network" if address is None else address.kind}
    if address is not None and address.kind == "nobodys":
        data["networkUrl"] = env().WEB_BASE_URL
    data["scope"] = (
        None
        if scoped is None
        else {
            "code": scoped["code"],
            "hospitalId": scoped["hospitalId"],
            "nameBn": scoped["nameBn"],
            "nameEn": scoped["nameEn"],
            "theme": scoped["theme"],
            "descriptionBn": scoped["descriptionBn"],
            "descriptionEn": scoped["descriptionEn"],
            "logoVersion": scoped["logoVersion"],
            "logoImage": scoped["logoImage"],
            "modulesOff": scoped["modulesOff"],
            "notShared": scoped["notShared"],
            "byAddress": at_portal is not None,
        }
    )
    return ok(data)


def get_logo(req: ApiRequest) -> Reply:
    file = discovery.logo(req.params["id"])
    if file is None:
        raise not_found("logo")
    version = req.query_raw.get("v")
    return raw_reply(
        file["bytes"],
        file["contentType"],
        headers={
            "Cache-Control": "public, max-age=31536000, immutable"
            if version == file["version"]
            else "public, max-age=300",
            "Cross-Origin-Resource-Policy": "cross-origin",
        },
    )
