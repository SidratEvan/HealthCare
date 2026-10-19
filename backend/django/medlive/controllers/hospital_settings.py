"""S-B-11 hospital settings (port of `controllers/hospitalSettings.controller.ts`; BACKEND.md §7.7).

The one decision made here is which facility: always the signed-in
administrator's own, from the principal, never from the request (FR-ROLE-01).
"""

from __future__ import annotations

from typing import Any

from ..core.errors import auth_required, forbidden_scope, not_found
from ..core.http import ApiRequest, Reply, ok, raw_reply
from ..services import hospital_settings as settings
from ..services import notification as notifications


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


def _id_of(req: ApiRequest) -> str:
    return req.params["id"]


def _done(data: Any = None) -> Reply:
    return ok({"saved": True} if data is None else data)


def get_setup(req: ApiRequest) -> Reply:
    return _done(settings.setup(_actor_of(req)["hospitalId"]))


def get_messages(req: ApiRequest) -> Reply:
    return _done(notifications.month_of_messages(_actor_of(req)["hospitalId"]))


def patch_profile(req: ApiRequest) -> Reply:
    settings.update_profile(_actor_of(req), req.body)
    return _done()


def put_publishing(req: ApiRequest) -> Reply:
    settings.update_publishing(_actor_of(req), req.body)
    return _done()


def put_brand(req: ApiRequest) -> Reply:
    settings.update_brand(_actor_of(req), req.body)
    return _done()


def put_logo(req: ApiRequest) -> Reply:
    return _done(settings.set_logo(_actor_of(req), req.body))


def delete_logo(req: ApiRequest) -> Reply:
    settings.remove_logo(_actor_of(req))
    return _done()


def get_own_logo(req: ApiRequest) -> Reply:
    file = settings.own_logo(_actor_of(req)["hospitalId"])
    if file is None:
        raise not_found("logo")
    return raw_reply(file["bytes"], file["contentType"], headers={"Cache-Control": "private, no-store"})


def get_desks(req: ApiRequest) -> Reply:
    return ok({"desks": settings.list_desks(_actor_of(req)["hospitalId"])})


def post_desk(req: ApiRequest) -> Reply:
    return _done(settings.add_desk(_actor_of(req), req.body))


def patch_desk(req: ApiRequest) -> Reply:
    settings.update_desk(_actor_of(req), _id_of(req), req.body)
    return _done()


def delete_desk(req: ApiRequest) -> Reply:
    settings.remove_desk(_actor_of(req), _id_of(req))
    return _done({"removed": True})


def get_brand(req: ApiRequest) -> Reply:
    return ok(settings.workspace_brand(_actor_of(req)["hospitalId"]))


def patch_rules(req: ApiRequest) -> Reply:
    settings.update_rules(_actor_of(req), req.body)
    return _done()


def post_department(req: ApiRequest) -> Reply:
    return _done(settings.create_department(_actor_of(req), req.body))


def patch_department(req: ApiRequest) -> Reply:
    settings.update_department(_actor_of(req), _id_of(req), req.body)
    return _done()


def delete_department(req: ApiRequest) -> Reply:
    settings.remove_department(_actor_of(req), _id_of(req))
    return _done({"removed": True})


def post_doctor(req: ApiRequest) -> Reply:
    return _done(settings.add_doctor(_actor_of(req), req.body))


def patch_doctor(req: ApiRequest) -> Reply:
    settings.update_doctor(_actor_of(req), _id_of(req), req.body)
    return _done()


def post_template(req: ApiRequest) -> Reply:
    return _done(settings.add_schedule(_actor_of(req), req.body))


def delete_template(req: ApiRequest) -> Reply:
    return _done(settings.remove_schedule(_actor_of(req), _id_of(req)))


def post_ward(req: ApiRequest) -> Reply:
    return _done(settings.add_ward(_actor_of(req), req.body))


def post_beds(req: ApiRequest) -> Reply:
    return _done(settings.add_beds(_actor_of(req), req.body))


def patch_bed(req: ApiRequest) -> Reply:
    settings.update_bed(_actor_of(req), _id_of(req), req.body)
    return _done()


def delete_bed(req: ApiRequest) -> Reply:
    settings.remove_bed(_actor_of(req), _id_of(req))
    return _done({"removed": True})


def patch_ward(req: ApiRequest) -> Reply:
    settings.update_ward(_actor_of(req), _id_of(req), req.body)
    return _done()


def delete_ward(req: ApiRequest) -> Reply:
    settings.remove_ward(_actor_of(req), _id_of(req))
    return _done({"removed": True})


def post_staff(req: ApiRequest) -> Reply:
    return _done(settings.add_staff(_actor_of(req), req.body))


def patch_staff(req: ApiRequest) -> Reply:
    settings.update_staff(_actor_of(req), _id_of(req), req.body)
    return _done()


def post_reset_password(req: ApiRequest) -> Reply:
    return _done(settings.reset_staff_password(_actor_of(req), _id_of(req)))


def post_reset_two_factor(req: ApiRequest) -> Reply:
    settings.reset_staff_two_factor(_actor_of(req), _id_of(req))
    return _done({"reset": True})


def put_capabilities(req: ApiRequest) -> Reply:
    settings.declare_capabilities(_actor_of(req), req.body)
    return _done()


def post_request_review(req: ApiRequest) -> Reply:
    settings.request_review(_actor_of(req))
    return _done({"requested": True})
