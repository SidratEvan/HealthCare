"""The password-less demonstration picker (port of `services/demo.service.ts`; CLAUDE.md §4.1, FR-DEM-*).

Only where `DEMO_MODE=true`: pick a facility and a console and receive a
twelve-hour token for that facility's demonstration account in that role.
"""

from __future__ import annotations

from typing import Any

from ..core.env import env
from ..core.errors import AppError, not_found
from ..core.jwt import sign_token
from ..repositories import demo as demo_repo
from . import modules

OFFERED = ("receptionist", "doctor", "ward", "emergency", "lab", "pharmacy", "hospital_admin")
OFFERED_NATIONAL = ("gov_viewer", "platform_admin")
DEMO_TOKEN_TTL = "12h"


def _assert_demo_mode() -> None:
    if not env().DEMO_MODE:
        raise AppError(
            "AUTH_FORBIDDEN_SCOPE",
            message="Demo sign-in is only available on a demonstration deployment.",
            details={"reason": "demo_mode_off"},
        )


def status() -> dict[str, bool]:
    return {"demoMode": env().DEMO_MODE}


def list_consoles() -> list[dict[str, Any]]:
    _assert_demo_mode()
    return [
        {
            "hospitalId": row["hospitalId"],
            "nameBn": row["nameBn"],
            "nameEn": row["nameEn"],
            "district": row["district"],
            "roles": [role for role in OFFERED if role in row["roles"]],
            "modulesOff": list(modules.modules_off(row["hospitalId"])),
            "sessions": row["sessions"],
            "desks": row["desks"],
        }
        for row in demo_repo.list_consoles()
    ]


def list_national_consoles() -> list[str]:
    _assert_demo_mode()
    present = demo_repo.national_roles()
    return [role for role in OFFERED_NATIONAL if role in present]


def _not_offered(role: str) -> AppError:
    return AppError(
        "AUTH_FORBIDDEN_SCOPE",
        message="That console is not built in this version.",
        details={"reason": "role_not_offered", "role": role},
    )


def mint_national_principal(*, role: str) -> dict[str, Any]:
    _assert_demo_mode()
    if role not in OFFERED_NATIONAL:
        raise _not_offered(role)
    staff = demo_repo.national_staff_for(role)
    if staff is None:
        raise not_found("staff account")
    return {
        "token": sign_token("access", {"sub": staff["id"], "kind": "staff", "roles": [role]}, DEMO_TOKEN_TTL),
        "staffName": staff["fullName"],
        "hospitalId": None,
        "role": role,
    }


def mint_principal(*, hospital_id: str, role: str) -> dict[str, Any]:
    _assert_demo_mode()
    if role not in OFFERED:
        raise _not_offered(role)
    staff = demo_repo.staff_for(hospital_id, role)
    if staff is None:
        raise not_found("staff account")
    return {
        "token": sign_token(
            "access",
            {"sub": staff["id"], "kind": "staff", "hospitalId": hospital_id, "roles": [role]},
            DEMO_TOKEN_TTL,
        ),
        "staffName": staff["fullName"],
        "hospitalId": hospital_id,
        "role": role,
    }
