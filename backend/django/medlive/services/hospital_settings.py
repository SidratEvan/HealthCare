"""A facility sets itself up (port of `services/hospitalSettings.service.ts`;
S-B-11, FR-SUP-01, FR-ADM-11, BACKEND.md §7.7 `/hospital/*`).

Every change is one transaction with its `SETTINGS_CHANGE` audit row (DB-P7).
Rules the forms do not show:

- A doctor's identity is editable only while the BMDC number is unverified
  and the doctor sits at no other facility (FR-SUP-02).
- Adding a doctor whose BMDC number is known links that doctor: one person,
  one record.
- A fee or room change reaches the doctor's chambers from today that are
  still scheduled; a booking keeps the fee it was made at (DB-P5).
- A bed added here starts out of service, "not yet confirmed" (§3.2).
- An administrator cannot deactivate themself, drop their own administrator
  role, or reset their own password or second factor here.
"""

from __future__ import annotations

import base64
import hashlib
from typing import Any, Callable

from ..core import db
from ..core.errors import AppError, not_found, validation_failed
from ..core.password import hash_password, temporary_password
from ..domain.brand import LOGO_MAX_BYTES, brand_problems, logo_bytes_match
from ..domain.org import identity_editable, missing_for_review, next_lifecycle
from ..domain.schemas.settings import BED_UNCONFIRMED_REASON
from ..realtime.auth import drop_hospital_sockets
from ..repositories import hospital_settings as repo
from ..repositories import platform as platform_repo
from ..repositories import staff_auth as staff_auth_repo
from . import portal as portals
from .access_guard import revoke_staff_sessions
from .deployment import online_payments_available
from .session_materialise import materialise


def _duplicate(field: str, extra: dict[str, Any] | None = None) -> AppError:
    return AppError("SETTINGS_DUPLICATE", details={"field": field, **(extra or {})})


def _not_allowed(reason: str, extra: dict[str, Any] | None = None) -> AppError:
    return AppError("SETTINGS_NOT_ALLOWED", details={"reason": reason, **(extra or {})})


def _change(actor: dict[str, Any], table: str, change: str, body: Callable[[], tuple[Any, str | None]]) -> Any:
    """One change and its audit row, together or not at all."""
    with db.transaction():
        result, subject_id = body()
        repo.record_change(
            actor_staff_id=actor["staffId"],
            hospital_id=actor["hospitalId"],
            subject_table=table,
            subject_id=subject_id,
            change=change,
            ip=actor["ip"],
            user_agent=actor["userAgent"],
        )
        return result


def _present(body: dict[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
    """The fields the body carries: an absent one is kept, a null one cleared."""
    return {key: body[key] for key in keys if key in body}


# --- reading ----------------------------------------------------------------


def setup(hospital_id: str) -> dict[str, Any]:
    snapshot = repo.snapshot(hospital_id)
    counts = platform_repo.setup_counts(hospital_id)
    if snapshot is None or counts is None:
        raise not_found("hospital")
    return {
        **snapshot,
        "counts": counts,
        "portal": portals.portal_addresses(snapshot["hospital"]["code"], snapshot["hospital"]["portalDomain"]),
        "onlinePayments": online_payments_available(),
    }


# --- profile and rules ------------------------------------------------------


def update_profile(actor: dict[str, Any], body: dict[str, Any]) -> None:
    fields = {key: value for key, value in body.items() if key != "coordinates"}
    if any(key in fields for key in ("division", "district", "registrationNo")):
        workspace = platform_repo.find_workspace(actor["hospitalId"])
        if workspace is None:
            raise not_found("hospital")
        if not identity_editable(workspace["lifecycle"]):
            raise _not_allowed("identity_after_review", {"lifecycle": workspace["lifecycle"]})
    if "coordinates" in body:
        coordinates = body["coordinates"]
        fields["lat"] = None if coordinates is None else coordinates["lat"]
        fields["lng"] = None if coordinates is None else coordinates["lng"]

    def write() -> tuple[None, str]:
        repo.update_profile(actor["hospitalId"], fields)
        return None, actor["hospitalId"]

    _change(actor, "hospitals", "profile", write)


def update_publishing(actor: dict[str, Any], body: dict[str, Any]) -> None:
    def write() -> tuple[None, str]:
        repo.set_unpublished(actor["hospitalId"], body["unpublished"])
        return None, actor["hospitalId"]

    _change(actor, "hospital_settings", "publishing", write)


def update_brand(actor: dict[str, Any], body: dict[str, Any]) -> None:
    theme = body["theme"]
    if theme is not None:
        problems = brand_problems(theme)
        if problems:
            raise _not_allowed("brand_unreadable", {"problems": problems})

    def write() -> tuple[None, str]:
        repo.set_brand(actor["hospitalId"], theme)
        return None, actor["hospitalId"]

    _change(actor, "hospital_settings", "brand_cleared" if theme is None else "brand", write)


def _node_base64(text: str) -> bytes:
    from .clinical import _node_base64 as decode

    return decode(text)


def set_logo(actor: dict[str, Any], body: dict[str, Any]) -> dict[str, str]:
    data = _node_base64(body["content"])
    if len(data) == 0 or len(data) > LOGO_MAX_BYTES:
        raise validation_failed({"field": "content", "reason": "logo_too_large"})
    if not logo_bytes_match(body["fileType"], data):
        raise validation_failed({"field": "content", "reason": "logo_not_that_image"})
    sha256 = hashlib.sha256(data).hexdigest()

    def write() -> tuple[None, str]:
        repo.set_logo(
            hospital_id=actor["hospitalId"], content_type=body["fileType"], data=data, sha256=sha256, staff_id=actor["staffId"]
        )
        return None, actor["hospitalId"]

    _change(actor, "hospital_logos", "logo", write)
    return {"version": sha256[:16]}


def remove_logo(actor: dict[str, Any]) -> None:
    def write() -> tuple[None, str]:
        repo.remove_logo(actor["hospitalId"])
        return None, actor["hospitalId"]

    _change(actor, "hospital_logos", "logo_removed", write)


def own_logo(hospital_id: str) -> dict[str, Any] | None:
    return repo.own_logo(hospital_id)


def workspace_brand(hospital_id: str) -> dict[str, Any]:
    snapshot = repo.snapshot(hospital_id)
    logo = repo.own_logo(hospital_id)
    if snapshot is None:
        raise not_found("hospital")
    return {
        "nameBn": snapshot["hospital"]["nameBn"],
        "nameEn": snapshot["hospital"]["nameEn"],
        "theme": snapshot["face"]["theme"],
        "logo": None
        if logo is None
        else f"data:{logo['contentType']};base64,{base64.b64encode(logo['bytes']).decode('ascii')}",
    }


def update_rules(actor: dict[str, Any], body: dict[str, Any]) -> None:
    def write() -> tuple[None, str]:
        repo.update_rules(actor["hospitalId"], body)
        return None, actor["hospitalId"]

    _change(actor, "hospital_settings", "queue_rules", write)


# --- departments ------------------------------------------------------------


def create_department(actor: dict[str, Any], body: dict[str, Any]) -> dict[str, str]:
    if repo.department_code_taken(actor["hospitalId"], body["code"]):
        raise _duplicate("code")

    def write() -> tuple[dict[str, str], str]:
        department_id = repo.create_department(
            hospital_id=actor["hospitalId"],
            name_bn=body["nameBn"],
            name_en=body["nameEn"],
            code=body["code"],
            sort_order=body.get("sortOrder", 0),
            created_by=actor["staffId"],
        )
        return {"departmentId": department_id}, department_id

    return _change(actor, "departments", "department_added", write)


def update_department(actor: dict[str, Any], department_id: str, body: dict[str, Any]) -> None:
    def write() -> tuple[None, str]:
        if not repo.update_department(actor["hospitalId"], department_id, body):
            raise not_found("department")
        return None, department_id

    _change(actor, "departments", "department_changed", write)


def remove_department(actor: dict[str, Any], department_id: str) -> None:
    def write() -> tuple[None, str]:
        outcome = repo.remove_department(actor["hospitalId"], department_id)
        if not outcome["removed"]:
            raise _not_allowed("department_has_doctors") if outcome["inUse"] else not_found("department")
        return None, department_id

    _change(actor, "departments", "department_removed", write)


# --- doctors ----------------------------------------------------------------


def add_doctor(actor: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    if not repo.department_belongs(actor["hospitalId"], body["departmentId"]):
        raise not_found("department")
    known = repo.doctor_by_bmdc(body["bmdcNumber"])
    if known is not None and repo.doctor_already_here(actor["hospitalId"], known["id"], body["departmentId"]):
        raise _duplicate("bmdcNumber")

    def write() -> tuple[dict[str, Any], str]:
        doctor_id = (
            known["id"]
            if known is not None
            else repo.create_doctor(
                name_bn=body["nameBn"],
                name_en=body["nameEn"],
                bmdc_number=body["bmdcNumber"],
                degrees=body.get("degrees"),
                specialties=body.get("specialties", []),
                default_consult_minutes=body.get("defaultConsultMinutes", 15),
                created_by=actor["staffId"],
            )
        )
        doctor_hospital_id = repo.link_doctor(
            doctor_id=doctor_id,
            hospital_id=actor["hospitalId"],
            department_id=body["departmentId"],
            fee_poisha=body["feePoisha"],
            room=body.get("room"),
            created_by=actor["staffId"],
        )
        return (
            {"doctorHospitalId": doctor_hospital_id, "doctorId": doctor_id, "linkedExisting": known is not None},
            doctor_hospital_id,
        )

    return _change(actor, "doctor_hospitals", "doctor_added", write)


def update_doctor(actor: dict[str, Any], doctor_hospital_id: str, body: dict[str, Any]) -> None:
    chamber = repo.chamber_of_doctor(actor["hospitalId"], doctor_hospital_id)
    if chamber is None:
        raise not_found("doctor")
    terms = _present(body, ("feePoisha", "room", "isActive"))
    identity = {key: value for key, value in body.items() if key not in ("feePoisha", "room", "isActive")}
    touches_identity = len(identity) > 0
    if touches_identity:
        if chamber["verified"]:
            raise _not_allowed("doctor_verified")
        if repo.doctor_sits_elsewhere(chamber["doctorId"], actor["hospitalId"]):
            raise _not_allowed("doctor_shared")

    def write() -> tuple[None, str]:
        if touches_identity:
            repo.update_doctor_identity(chamber["doctorId"], identity)
        if terms:
            repo.update_doctor_hospital(doctor_hospital_id, terms)
        if "feePoisha" in terms or "room" in terms:
            repo.carry_to_scheduled_sessions(
                hospital_id=actor["hospitalId"],
                doctor_id=chamber["doctorId"],
                department_id=chamber["departmentId"],
                fields=_present(terms, ("feePoisha", "room")),
            )
        return None, doctor_hospital_id

    _change(actor, "doctor_hospitals", "doctor_changed", write)
    # A doctor made active again gets their chambers back straight away.
    if body.get("isActive") is True:
        materialise()


# --- weekly schedules -------------------------------------------------------


def add_schedule(actor: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    chamber = repo.chamber_of_doctor(actor["hospitalId"], body["doctorHospitalId"])
    if chamber is None:
        raise not_found("doctor")
    if repo.template_overlaps(
        doctor_id=chamber["doctorId"], weekday=body["weekday"], start_time=body["startTime"], end_time=body["endTime"]
    ):
        raise _duplicate("schedule")

    def write() -> tuple[str, str]:
        template_id = repo.create_template(
            doctor_hospital_id=body["doctorHospitalId"],
            weekday=body["weekday"],
            start_time=body["startTime"],
            end_time=body["endTime"],
            capacity=body.get("capacity"),
            created_by=actor["staffId"],
        )
        return template_id, template_id

    template_id = _change(actor, "session_templates", "schedule_added", write)
    # Its chambers now, not at the next hourly run.
    sessions_created = materialise(only_template=template_id)
    return {"templateId": template_id, "sessionsCreated": sessions_created}


def remove_schedule(actor: dict[str, Any], template_id: str) -> dict[str, int]:
    if repo.template_of(actor["hospitalId"], template_id) is None:
        raise not_found("schedule")

    def write() -> tuple[dict[str, int], str]:
        kept = repo.end_template(template_id)
        return {"bookedChambersKept": kept}, template_id

    return _change(actor, "session_templates", "schedule_removed", write)


# --- wards and beds ---------------------------------------------------------


def add_ward(actor: dict[str, Any], body: dict[str, Any]) -> dict[str, str]:
    def write() -> tuple[dict[str, str], str]:
        ward_id = repo.create_ward(
            hospital_id=actor["hospitalId"],
            name_bn=body["nameBn"],
            name_en=body["nameEn"],
            floor=body["floor"],
            kind=body["kind"],
            created_by=actor["staffId"],
        )
        return {"wardId": ward_id}, ward_id

    return _change(actor, "wards", "ward_added", write)


def add_beds(actor: dict[str, Any], body: dict[str, Any]) -> dict[str, list[str]]:
    if repo.ward_of(actor["hospitalId"], body["wardId"]) is None:
        raise not_found("ward")
    taken = [label for label in body["labels"] if repo.bed_label_taken(actor["hospitalId"], label, None)]
    if taken:
        raise _duplicate("label", {"labels": taken})

    def write() -> tuple[dict[str, list[str]], str]:
        bed_ids = [
            repo.create_bed(
                hospital_id=actor["hospitalId"],
                ward_id=body["wardId"],
                label=label,
                kind=body["kind"],
                nightly_poisha=body["nightlyPoisha"],
                unconfirmed_reason=BED_UNCONFIRMED_REASON,
                created_by=actor["staffId"],
            )
            for label in body["labels"]
        ]
        return {"bedIds": bed_ids}, body["wardId"]

    return _change(actor, "beds", "beds_added", write)


def update_bed(actor: dict[str, Any], bed_id: str, body: dict[str, Any]) -> None:
    if "label" in body and repo.bed_label_taken(actor["hospitalId"], body["label"], bed_id):
        raise _duplicate("label", {"labels": [body["label"]]})

    def write() -> tuple[None, str]:
        if not repo.update_bed(actor["hospitalId"], bed_id, body):
            raise not_found("bed")
        return None, bed_id

    _change(actor, "beds", "bed_changed", write)


def update_ward(actor: dict[str, Any], ward_id: str, body: dict[str, Any]) -> None:
    if "nameEn" in body and repo.ward_name_taken(actor["hospitalId"], body["nameEn"], ward_id):
        raise _duplicate("nameEn")

    def write() -> tuple[None, str]:
        if not repo.update_ward(actor["hospitalId"], ward_id, body):
            raise not_found("ward")
        return None, ward_id

    _change(actor, "wards", "ward_changed", write)


def remove_ward(actor: dict[str, Any], ward_id: str) -> None:
    def write() -> tuple[None, str]:
        outcome = repo.remove_ward(actor["hospitalId"], ward_id)
        if not outcome["removed"]:
            raise _not_allowed("ward_has_beds") if outcome["inUse"] else not_found("ward")
        return None, ward_id

    _change(actor, "wards", "ward_removed", write)


def remove_bed(actor: dict[str, Any], bed_id: str) -> None:
    def write() -> tuple[None, str]:
        outcome = repo.remove_unconfirmed_bed(actor["hospitalId"], bed_id)
        if not outcome["removed"]:
            raise _not_allowed("bed_in_use") if outcome["inUse"] else not_found("bed")
        return None, bed_id

    _change(actor, "beds", "bed_removed", write)


# --- staff (FR-ADM-11, FR-SUP-01) -------------------------------------------


def add_staff(actor: dict[str, Any], body: dict[str, Any]) -> dict[str, str]:
    if staff_auth_repo.email_taken_at(actor["hospitalId"], body["email"]):
        raise _duplicate("email")
    staff_code = body.get("staffCode")
    if staff_code is not None and repo.staff_code_taken(actor["hospitalId"], staff_code, None):
        raise _duplicate("staffCode")
    # Shown once, to the administrator, to hand over in person. Never logged.
    password = temporary_password()
    password_hash = hash_password(password)

    def write() -> tuple[dict[str, str], str]:
        staff_id = staff_auth_repo.create_staff_account(
            hospital_id=actor["hospitalId"],
            email=body["email"],
            full_name=body["fullName"],
            staff_code=staff_code,
            password_hash=password_hash,
            created_by=actor["staffId"],
        )
        repo.set_roles(staff_id=staff_id, hospital_id=actor["hospitalId"], roles=body["roles"], by=actor["staffId"])
        return {"staffId": staff_id, "temporaryPassword": password}, staff_id

    return _change(actor, "staff_users", "staff_added", write)


def update_staff(actor: dict[str, Any], staff_id: str, body: dict[str, Any]) -> None:
    if repo.staff_of(actor["hospitalId"], staff_id) is None:
        raise not_found("staff")
    own = staff_id == actor["staffId"]
    if own and body.get("isActive") is False:
        raise _not_allowed("own_access")
    if own and "roles" in body and "hospital_admin" not in body["roles"]:
        raise _not_allowed("own_access")
    staff_code = body.get("staffCode")
    if staff_code is not None and repo.staff_code_taken(actor["hospitalId"], staff_code, staff_id):
        raise _duplicate("staffCode")

    def write() -> tuple[None, str]:
        repo.update_staff(staff_id, _present(body, ("fullName", "isActive", "staffCode")))
        if "roles" in body:
            repo.set_roles(staff_id=staff_id, hospital_id=actor["hospitalId"], roles=body["roles"], by=actor["staffId"])
        return None, staff_id

    _change(actor, "staff_users", "staff_changed", write)
    # A deactivated account, or one whose roles changed, signs in again.
    if body.get("isActive") is False or "roles" in body:
        revoke_staff_sessions(staff_id)


def reset_staff_password(actor: dict[str, Any], staff_id: str) -> dict[str, str]:
    if staff_id == actor["staffId"]:
        raise _not_allowed("own_password")
    if repo.staff_of(actor["hospitalId"], staff_id) is None:
        raise not_found("staff")
    password = temporary_password()
    password_hash = hash_password(password)

    def write() -> tuple[None, str]:
        staff_auth_repo.set_password(staff_id, password_hash, True)
        return None, staff_id

    _change(actor, "staff_users", "password_reset", write)
    revoke_staff_sessions(staff_id)
    return {"temporaryPassword": password}


def reset_staff_two_factor(actor: dict[str, Any], staff_id: str) -> None:
    if staff_id == actor["staffId"]:
        raise _not_allowed("own_two_factor")
    if repo.staff_of(actor["hospitalId"], staff_id) is None:
        raise not_found("staff")

    def write() -> tuple[None, str]:
        staff_auth_repo.clear_two_factor(staff_id)
        return None, staff_id

    _change(actor, "staff_users", "two_factor_reset", write)
    revoke_staff_sessions(staff_id)


# --- capabilities (FR-EMG-05) -----------------------------------------------


def declare_capabilities(actor: dict[str, Any], body: dict[str, Any]) -> None:
    def write() -> tuple[None, str]:
        repo.declare_capabilities(hospital_id=actor["hospitalId"], kinds=body["kinds"], by=actor["staffId"])
        return None, actor["hospitalId"]

    _change(actor, "capabilities", "capabilities_declared", write)


# --- going live ---------------------------------------------------------------


def request_review(actor: dict[str, Any]) -> None:
    """The hospital's half of going live (FR-ONB-04): it asks; the platform approves."""
    workspace = platform_repo.find_workspace(actor["hospitalId"])
    if workspace is None:
        raise not_found("hospital")
    to = next_lifecycle(workspace["lifecycle"], "request_review")
    if to is None:
        raise _not_allowed("wrong_state", {"lifecycle": workspace["lifecycle"]})
    missing = missing_for_review(workspace["counts"])
    if missing:
        raise _not_allowed("not_ready", {"missing": missing})

    def write() -> tuple[None, str]:
        moved = platform_repo.move_lifecycle(
            hospital_id=actor["hospitalId"], frm=workspace["lifecycle"], to=to, reviewed_by=None
        )
        if not moved:
            raise _not_allowed("changed_meanwhile")
        return None, actor["hospitalId"]

    _change(actor, "hospitals", "review_requested", write)


def verify_doctor(bmdc_number: str) -> str | None:
    """`pnpm doctor:verify` (FR-SUP-02): platform staff, after checking the register."""
    return repo.mark_doctor_verified(bmdc_number)


# --- reception desks (FR-REC-32) ----------------------------------------------


def list_desks(hospital_id: str) -> list[dict[str, Any]]:
    return repo.list_desks(hospital_id)


def _assert_own_doctors(hospital_id: str, doctor_ids: list[str]) -> None:
    strangers = repo.doctors_not_here(hospital_id, doctor_ids)
    if strangers:
        raise _not_allowed("doctor_not_here", {"doctorIds": strangers})


def _assert_own_receptionists(hospital_id: str, staff_ids: list[str]) -> None:
    strangers = repo.staff_not_receptionists(hospital_id, staff_ids)
    if strangers:
        raise _not_allowed("not_a_receptionist_here", {"staffIds": strangers})


def add_desk(actor: dict[str, Any], body: dict[str, Any]) -> dict[str, str]:
    if repo.desk_name_taken(actor["hospitalId"], body["nameEn"], None):
        raise _duplicate("nameEn")
    _assert_own_doctors(actor["hospitalId"], body["doctorIds"])
    _assert_own_receptionists(actor["hospitalId"], body["staffIds"])

    def write() -> tuple[dict[str, str], str]:
        desk_id = repo.create_desk(
            hospital_id=actor["hospitalId"], name_bn=body["nameBn"], name_en=body["nameEn"], created_by=actor["staffId"]
        )
        repo.set_desk_doctors(actor["hospitalId"], desk_id, body["doctorIds"])
        repo.set_desk_staff(actor["hospitalId"], desk_id, body["staffIds"])
        return {"deskId": desk_id}, desk_id

    result = _change(actor, "reception_desks", "desk_added", write)
    drop_hospital_sockets(actor["hospitalId"])
    return result


def _members_equal(a: list[str], b: list[str]) -> bool:
    return sorted(set(a)) == sorted(set(b))


def update_desk(actor: dict[str, Any], desk_id: str, body: dict[str, Any]) -> None:
    if "nameEn" in body and repo.desk_name_taken(actor["hospitalId"], body["nameEn"], desk_id):
        raise _duplicate("nameEn")
    if "doctorIds" in body:
        _assert_own_doctors(actor["hospitalId"], body["doctorIds"])
    if "staffIds" in body:
        _assert_own_receptionists(actor["hospitalId"], body["staffIds"])

    def write() -> tuple[None, str]:
        # Compared under the row lock every PATCH takes (FR-REC-32, DB-P1).
        current = repo.desk_for_update(actor["hospitalId"], desk_id)
        if current is None:
            raise not_found("desk")
        expected = body.get("expected")
        if expected is not None and (
            current["nameBn"] != expected["nameBn"]
            or current["nameEn"] != expected["nameEn"]
            or not _members_equal(current["doctorIds"], expected["doctorIds"])
            or not _members_equal(current["staffIds"], expected["staffIds"])
        ):
            raise _not_allowed("desk_changed")
        # Renaming nothing still finds the desk, so an unknown one is a 404.
        if not repo.rename_desk(actor["hospitalId"], desk_id, body):
            raise not_found("desk")
        if "doctorIds" in body:
            repo.set_desk_doctors(actor["hospitalId"], desk_id, body["doctorIds"])
        if "staffIds" in body:
            repo.set_desk_staff(actor["hospitalId"], desk_id, body["staffIds"])
        return None, desk_id

    _change(actor, "reception_desks", "desk_changed", write)
    drop_hospital_sockets(actor["hospitalId"])


def remove_desk(actor: dict[str, Any], desk_id: str) -> None:
    def write() -> tuple[None, str]:
        if not repo.remove_desk(actor["hospitalId"], desk_id):
            raise not_found("desk")
        return None, desk_id

    _change(actor, "reception_desks", "desk_removed", write)
    drop_hospital_sockets(actor["hospitalId"])
