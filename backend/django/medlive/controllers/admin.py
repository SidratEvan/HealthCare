"""The admin dashboard endpoints (port of `controllers/admin.controller.ts`; BACKEND.md §7.7, S-B-10).

Which hospital is decided once, here, from the principal and never from
anything the caller sent: an aggregate endpoint that honoured a hospital in
the query would let one administrator read another's revenue (FR-ROLE-01).
"""

from __future__ import annotations

from ..core.errors import AppError, forbidden_scope
from ..core.http import ApiRequest, Reply, ok, raw_reply
from ..domain.time import now_iso, to_dhaka_date
from ..services import admin as admin_service


def _hospital_of(req: ApiRequest) -> str:
    principal = req.principal
    if principal is None:
        raise forbidden_scope({"reason": "no_principal"})
    if principal.kind != "staff" or principal.hospital_id is None:
        raise forbidden_scope({"reason": "not_hospital_staff"})
    return principal.hospital_id


def _range_of(req: ApiRequest) -> tuple[str, str]:
    date_to = req.query.get("to") or to_dhaka_date(now_iso())
    date_from = req.query.get("from") or date_to
    return date_from, date_to


def get_dashboard(req: ApiRequest) -> Reply:
    date_from, date_to = _range_of(req)
    return ok(admin_service.dashboard(hospital_id=_hospital_of(req), date_from=date_from, date_to=date_to))


def get_overview(req: ApiRequest) -> Reply:
    return ok(admin_service.overview(_hospital_of(req)))


def get_export(req: ApiRequest) -> Reply:
    view = req.query.get("view") or ""
    if not admin_service.is_exportable(view):
        raise AppError(
            "VALIDATION_FAILED",
            message="No such export.",
            details={"view": view, "allowed": list(admin_service.EXPORTABLE)},
        )
    date_from, date_to = _range_of(req)
    principal = req.principal
    result = admin_service.export_view(
        hospital_id=_hospital_of(req),
        date_from=date_from,
        date_to=date_to,
        view=view,
        staff_user_id=principal.id if principal is not None and principal.kind == "staff" else None,
        ip=req.ip or None,
        user_agent=req.get("user-agent"),
    )
    # Never cached: an export is an audited read of live figures.
    return raw_reply(
        result["csv"].encode("utf-8"),
        "text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{result["filename"]}"',
            "Cache-Control": "no-store",
        },
    )
