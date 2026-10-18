"""Which chambers a receptionist's desk reaches (port of `services/deskAccess.service.ts`; FR-REC-32)."""

from __future__ import annotations

from ..core.errors import forbidden_scope
from ..core.principal import Principal
from ..repositories import hospital_settings as settings_repo


def desk_limit(principal: Principal) -> set[str] | None:
    """The doctors this receptionist may act for, or None when nothing limits them."""
    if principal.kind != "staff":
        return None
    roles = principal.roles
    if "receptionist" not in roles:
        return None
    if "hospital_admin" in roles or "doctor" in roles:
        return None
    return settings_repo.desk_doctors_for_staff(principal.id, principal.hospital_id or "")


def assert_desk_allows(principal: Principal, session: dict) -> None:
    allowed = desk_limit(principal)
    if allowed is not None and session["doctorId"] not in allowed:
        raise forbidden_scope({"reason": "outside_your_desk"})
