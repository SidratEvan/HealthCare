"""S-B-14 imports (port of `controllers/import.controller.ts`; BACKEND.md §7.7).

The facility is the administrator's own, from the principal, never the request (FR-ROLE-01).
"""

from __future__ import annotations

from typing import Any

from ..core.errors import auth_required, forbidden_scope
from ..core.http import ApiRequest, Reply, ok, raw_reply
from ..services import import_mapping as mapping
from ..services import imports


def _actor_of(req: ApiRequest) -> dict[str, Any]:
    principal = req.principal
    if principal is None:
        raise auth_required()
    if principal.kind != "staff":
        raise forbidden_scope({"reason": "not_hospital_staff"})
    return {
        "staffId": principal.id,
        "hospitalId": principal.hospital_id,
        "ip": req.ip or None,
        "userAgent": req.get("user-agent"),
    }


def get_template(req: ApiRequest) -> Reply:
    """The template as a file to save, with a byte order mark so a spreadsheet reads the Bangla."""
    _actor_of(req)
    set_kind = req.params["set"]
    return raw_reply(
        ("﻿" + imports.template(set_kind)).encode("utf-8"),
        "text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="medlivebd-{set_kind}-template.csv"'},
    )


def list_batches(req: ApiRequest) -> Reply:
    return ok({"batches": imports.list_batches(_actor_of(req)["hospitalId"])})


def get_one(req: ApiRequest) -> Reply:
    return ok(imports.view(_actor_of(req)["hospitalId"], req.params["id"]))


def check(req: ApiRequest) -> Reply:
    body = req.body
    return ok(imports.check(_actor_of(req), set_kind=body["set"], file_name=body["fileName"], csv=body["csv"]))


def analyse(req: ApiRequest) -> Reply:
    body = req.body
    return ok(mapping.analyse(_actor_of(req), set_kind=body["set"], csv=body["csv"], row_type=body.get("rowType")))


def check_mapped(req: ApiRequest) -> Reply:
    body = req.body
    return ok(
        mapping.confirm(
            _actor_of(req),
            set_kind=body["set"],
            file_name=body["fileName"],
            csv=body["csv"],
            mapping=body["mapping"],
            suggested_by_model=body.get("suggestedByModel"),
        )
    )


def commit(req: ApiRequest) -> Reply:
    return ok(imports.commit(_actor_of(req), req.params["id"]))


def undo(req: ApiRequest) -> Reply:
    return ok(imports.undo(_actor_of(req), req.params["id"]))


def discard(req: ApiRequest) -> Reply:
    return ok(imports.discard(_actor_of(req), req.params["id"]))
