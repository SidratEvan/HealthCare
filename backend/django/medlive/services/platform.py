"""The platform's side of bringing a hospital on (port of `services/platform.service.ts`;
PRD.md §14c, FR-ONB-*, S-B-12).

A platform administrator creates a workspace with its first administrator,
verifies its doctors, and answers its request to go live; afterwards it can
suspend, reinstate or close it. None of it touches a patient (FR-ONB-08).
Approval counts the checklist again, and adds a verified doctor; every act is
audited with the workspace as its subject (FR-ONB-07).
"""

from __future__ import annotations

from typing import Any

from ..core import db
from ..core.errors import AppError, not_found, validation_failed
from ..core.schema import js_trim
from ..domain.modules import modules_problems
from ..domain.org import (
    action_needs_note,
    missing_for_approval,
    next_lifecycle,
    platform_actions,
    setup_checklist,
    workspace_health,
)
from ..domain.time import now_iso
from ..repositories import hospital_settings as settings_repo
from ..repositories import platform as repo
from ..repositories import staff_auth as staff_auth_repo
from . import modules
from . import portal as portals
from .staff_auth import create_first_administrator

TRAIL_LENGTH = 50


def _not_allowed(reason: str, extra: dict[str, Any] | None = None) -> AppError:
    return AppError("SETTINGS_NOT_ALLOWED", details={"reason": reason, **(extra or {})})


def _health_from(counts: dict[str, Any] | None, now: str) -> dict[str, Any]:
    counts = counts or {}
    return workspace_health(
        live=counts.get("live", False),
        stamps=counts.get("stamps", []),
        messages=counts.get("messages", {"sent": 0, "failed": 0, "held": 0, "waiting": 0}),
        sync=counts.get("sync", {"lateActions": 0, "slowestSeconds": 0, "lastLateAt": None}),
        now=now,
        threshold_minutes=counts.get("staleAfterMinutes", 10),
    )


def _summarise(row: dict[str, Any], health: dict[str, Any]) -> dict[str, Any]:
    return {
        **row,
        "checklist": setup_checklist(row["counts"]),
        "actions": platform_actions(row["lifecycle"]),
        "attention": health["attention"],
        "stalest": health["stalest"],
    }


def _record(actor: dict[str, Any], hospital_id: str, table: str, subject_id: str, change: str) -> None:
    settings_repo.record_change(
        actor_staff_id=actor["staffId"],
        hospital_id=hospital_id,
        subject_table=table,
        subject_id=subject_id,
        change=change,
        ip=actor["ip"],
        user_agent=actor["userAgent"],
    )


def list_workspaces() -> list[dict[str, Any]]:
    rows = repo.list_workspaces()
    health = repo.health_of_all()
    now = now_iso()
    return [_summarise(row, _health_from(health.get(row["id"]), now)) for row in rows]


def workspace(hospital_id: str) -> dict[str, Any]:
    row = repo.find_workspace(hospital_id)
    if row is None:
        raise not_found("hospital")
    doctors = repo.doctors_of(hospital_id)
    administrators = repo.administrators_of(hospital_id)
    phone = repo.facility_phone_of(hospital_id)
    usage = repo.usage_of(hospital_id)
    counts = repo.health_of(hospital_id)
    now = now_iso()
    health = _health_from(counts, now)
    return {
        **_summarise(row, health),
        "portal": portals.portal_addresses(row["code"], row["portalDomain"]),
        "phone": phone,
        "doctors": doctors,
        "administrators": administrators,
        "missingForApproval": missing_for_approval(row["counts"]),
        "usage": {**usage, "asOf": now},
        "health": {**health, "staleAfterMinutes": (counts or {}).get("staleAfterMinutes", 10), "asOf": now},
    }


def audit_trail(hospital_id: str) -> dict[str, Any]:
    if repo.find_workspace(hospital_id) is None:
        raise not_found("hospital")
    return {"entries": repo.audit_trail_of(hospital_id, TRAIL_LENGTH), "asOf": now_iso()}


def set_agreement(actor: dict[str, Any], hospital_id: str, state: str, note: str | None) -> dict[str, Any]:
    """A record of where the agreement stands; it switches nothing (FR-SUP-04)."""
    with db.transaction():
        found = repo.set_agreement(hospital_id=hospital_id, state=state, note=note, changed_by=actor["staffId"])
        if found:
            _record(actor, hospital_id, "hospitals", hospital_id, f"agreement_{state}")
    if not found:
        raise not_found("hospital")
    return workspace(hospital_id)


def set_modules(actor: dict[str, Any], hospital_id: str, off: list[str]) -> dict[str, Any]:
    if repo.find_workspace(hospital_id) is None:
        raise not_found("hospital")
    problems = modules_problems(off)
    if problems:
        raise _not_allowed(problems[0] or "modules", {"problems": problems})
    with db.transaction():
        settings_repo.set_modules_off(hospital_id, off)
        _record(actor, hospital_id, "hospital_settings", hospital_id, "modules")
    # Refused, and unpublished, from the next request.
    modules.forget_modules(hospital_id)
    return workspace(hospital_id)


def set_portal_domain(actor: dict[str, Any], hospital_id: str, domain: str | None) -> dict[str, Any]:
    if repo.find_workspace(hospital_id) is None:
        raise not_found("hospital")
    if domain is not None:
        own = portals.platform_domain()
        if own is not None and (domain == own or domain.endswith(f".{own}")):
            raise _not_allowed("domain_is_the_platforms")
        holder = repo.hospital_with_domain(domain)
        if holder is not None and holder != hospital_id:
            raise _not_allowed("domain_taken")
    with db.transaction():
        repo.set_portal_domain(hospital_id, domain)
        _record(actor, hospital_id, "hospitals", hospital_id, "portal_domain_removed" if domain is None else "portal_domain")
    # Answered for from the next request.
    portals.forget_recorded_domains()
    return workspace(hospital_id)


def create_workspace(actor: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    if staff_auth_repo.hospital_id_by_code(body["code"]) is not None:
        raise AppError("SETTINGS_DUPLICATE", details={"field": "code", "code": body["code"]})
    created = create_first_administrator(
        hospital_code=body["code"],
        hospital={
            "nameBn": body["nameBn"],
            "nameEn": body["nameEn"],
            "kind": body["kind"],
            "division": body["division"],
            "district": body["district"],
        },
        email=body["adminEmail"],
        full_name=body["adminName"],
    )
    with db.transaction():
        if "registrationNo" in body:
            repo.set_registration_no(created["hospitalId"], body["registrationNo"])
        _record(actor, created["hospitalId"], "hospitals", created["hospitalId"], "workspace_created")
    return {
        "hospitalId": created["hospitalId"],
        "code": body["code"],
        "adminEmail": body["adminEmail"],
        "temporaryPassword": created["temporaryPassword"],
    }


def act(actor: dict[str, Any], hospital_id: str, action: str, note: str | None) -> dict[str, Any]:
    """Approve, send back, suspend, reinstate or close (FR-ONB-04, FR-ONB-06).

    The state moves only from the state it was read in, so two administrators
    answering at once cannot both be recorded.
    """
    row = repo.find_workspace(hospital_id)
    if row is None:
        raise not_found("hospital")
    to = next_lifecycle(row["lifecycle"], action)
    if to is None:
        raise _not_allowed("wrong_state", {"lifecycle": row["lifecycle"], "action": action})
    if action_needs_note(action) and (note is None or js_trim(note) == ""):
        raise validation_failed({"note": "required"})
    if action == "approve":
        missing = missing_for_approval(row["counts"])
        if missing:
            raise _not_allowed("not_ready", {"missing": missing})
    with db.transaction():
        moved = repo.move_lifecycle(
            hospital_id=hospital_id,
            frm=row["lifecycle"],
            to=to,
            reviewed_by=actor["staffId"],
            # An approval or a reinstatement clears the last refusal's reason.
            note=(None if note is None else js_trim(note)) if action_needs_note(action) else None,
        )
        if not moved:
            raise _not_allowed("changed_meanwhile")
        _record(actor, hospital_id, "hospitals", hospital_id, f"workspace_{action}")
    return workspace(hospital_id)


def verify_doctor(actor: dict[str, Any], hospital_id: str, doctor_id: str) -> dict[str, Any]:
    """Records a doctor's BMDC verification from the review screen (FR-ONB-05)."""
    if repo.find_workspace(hospital_id) is None:
        raise not_found("hospital")
    with db.transaction():
        if not repo.verify_doctor_at(hospital_id=hospital_id, doctor_id=doctor_id):
            raise not_found("doctor")
        _record(actor, hospital_id, "doctors", doctor_id, "doctor_verified")
    return workspace(hospital_id)
