"""The doctor's consultation, the patient's records and their own papers
(port of `services/clinical.service.ts`; FR-DOC-01..08, FR-PAT-40, FR-PAT-6x, FR-SEC-03).

Who may read what is decided here, once: a patient reads their own
profiles; a doctor reads everything under a live consent, otherwise only
what their own hospital recorded, and only for someone it treated. Every
read is audited, and the audit failing fails the read.
"""

from __future__ import annotations

import re
import uuid as uuidlib
import base64
from typing import Any

from ..adapters.storage import storage
from ..core import db
from ..core.errors import AppError, forbidden_scope, guard_failed, not_found
from ..core.logging import logger
from ..core.schema import js_trim
from ..domain.documents import MAX_DOCUMENT_BYTES, document_key, sniff_document
from ..domain.time import now_iso, to_dhaka_date
from ..repositories import clinical as clinical_repo
from ..repositories import session as session_repo
from . import queue as queue_service


def _blank_to_null(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = js_trim(value)
    return None if trimmed == "" else trimmed


_NOT_BASE64 = re.compile(r"[^A-Za-z0-9+/]")


def _node_base64(text: str) -> bytes:
    """`Buffer.from(text, 'base64')`: the URL-safe alphabet is accepted, any
    other character is skipped, decoding stops at the first `=`, and a
    trailing lone character (six bits) is dropped."""
    body = text.split("=", 1)[0].replace("-", "+").replace("_", "/")
    body = _NOT_BASE64.sub("", body)
    if len(body) % 4 == 1:
        body = body[:-1]
    return base64.b64decode(body + "=" * (-len(body) % 4))


def _audit(principal: Any, patient_id: str, *, subject_table: str, subject_id: str | None, meta: dict[str, Any]) -> None:
    clinical_repo.record_record_view(
        staff_user_id=principal.id if principal.kind == "staff" else None,
        user_id=principal.id if principal.kind == "patient" else None,
        hospital_id=principal.hospital_id if principal.kind == "staff" else None,
        patient_id=patient_id,
        subject_table=subject_table,
        subject_id=subject_id,
        meta=meta,
    )


def _read_scope(principal: Any, patient_id: str) -> str:
    if principal.kind == "patient":
        if not clinical_repo.patient_belongs_to_user(patient_id, principal.id):
            raise forbidden_scope({"reason": "not_your_record"})
        return "everywhere"
    if principal.kind == "staff":
        if "doctor" not in principal.roles:
            raise forbidden_scope({"reason": "role_not_permitted"})
        if clinical_repo.has_live_consent(patient_id, principal.hospital_id):
            return "everywhere"
        if clinical_repo.treated_at_hospital(principal.hospital_id, patient_id):
            return "this_hospital"
        raise forbidden_scope({"reason": "no_treatment_relationship_or_consent"})
    if principal.kind == "guest":
        raise forbidden_scope({"reason": "guest_link_is_not_consent"})
    raise forbidden_scope({"reason": "aggregate_only"})


def patient_records(*, principal: Any, patient_id: str, booking_id: str | None) -> dict[str, Any]:
    patient = clinical_repo.find_patient(patient_id)
    if patient is None:
        raise not_found("patient")
    visits_from = _read_scope(principal, patient_id)
    intake = None
    if booking_id is not None:
        booking = clinical_repo.find_chamber_booking(booking_id)
        if booking is None:
            raise not_found("booking")
        if booking["patientId"] != patient_id:
            raise forbidden_scope({"reason": "booking_patient"})
        intake = clinical_repo.find_intake(booking_id)
    visits = clinical_repo.find_visits(
        patient_id,
        principal.hospital_id if visits_from == "this_hospital" and principal.kind == "staff" else None,
    )
    documents = clinical_repo.list_documents(patient_id) if visits_from == "everywhere" else []
    meta: dict[str, Any] = {"visits": len(visits), "documents": len(documents), "visitsFrom": visits_from}
    if booking_id is not None:
        meta["bookingId"] = booking_id
    _audit(principal, patient_id, subject_table="visits", subject_id=None, meta=meta)
    return {
        "patient": patient,
        "intake": intake,
        "visits": visits,
        "visitsFrom": visits_from,
        "documents": documents,
        "absent": ["reports"],
    }


def _assert_own_profile(principal: Any, patient_id: str) -> str:
    if principal.kind != "patient":
        raise forbidden_scope({"reason": "patient_only"})
    if not clinical_repo.patient_belongs_to_user(patient_id, principal.id):
        raise forbidden_scope({"reason": "not_your_record"})
    return principal.id


def upload_document(principal: Any, body: dict[str, Any]) -> dict[str, Any]:
    user_id = _assert_own_profile(principal, body["patientId"])
    data = _node_base64(body["dataBase64"])
    kind = None if len(data) == 0 else sniff_document(data)
    if kind is None or kind != body["contentType"] or len(data) > MAX_DOCUMENT_BYTES:
        raise AppError("DOCUMENT_NOT_SUPPORTED")
    doc_date = body.get("docDate")
    if doc_date is not None and doc_date > to_dhaka_date(now_iso()):
        raise guard_failed("DOCUMENT_DATE_IN_FUTURE", "A paper cannot be dated after today.")
    document_id = str(uuidlib.uuid4())
    key = document_key(body["patientId"], document_id, kind)
    try:
        storage().put(key=key, content_type=kind, data=data)
    except Exception as cause:
        logger.error({"documentId": document_id, "err": cause}, "document upload failed")
        raise AppError("DOCUMENT_STORAGE_FAILED", cause=cause) from cause
    return clinical_repo.insert_document(
        document_id=document_id,
        patient_id=body["patientId"],
        key=key,
        doc_type=body["docType"],
        doc_date=doc_date,
        doctor_name=_blank_to_null(body.get("doctorName")),
        content_type=kind,
        byte_size=len(data),
        user_id=user_id,
    )


def list_own_documents(principal: Any, patient_id: str) -> list[dict[str, Any]]:
    _assert_own_profile(principal, patient_id)
    return clinical_repo.list_documents(patient_id)


def remove_own_document(principal: Any, document_id: str) -> None:
    found = clinical_repo.find_document(document_id)
    if found is None:
        raise not_found("document")
    if principal.kind != "patient":
        raise forbidden_scope({"reason": "patient_only"})
    if not clinical_repo.patient_belongs_to_user(found["patientId"], principal.id):
        raise not_found("document")
    clinical_repo.remove_document(document_id)


def document_url(*, principal: Any, patient_id: str, document_id: str) -> str:
    if principal.kind == "patient":
        _assert_own_profile(principal, patient_id)
    elif principal.kind == "staff":
        if "doctor" not in principal.roles:
            raise forbidden_scope({"reason": "role_not_permitted"})
        if not clinical_repo.has_live_consent(patient_id, principal.hospital_id):
            raise forbidden_scope({"reason": "patient_document_needs_consent"})
    else:
        raise forbidden_scope({"reason": "patient_only"})
    found = clinical_repo.find_document(document_id)
    if found is None or found["patientId"] != patient_id:
        raise not_found("document")
    url = storage().signed_url(found["key"])
    if principal.kind == "staff":
        _audit(
            principal,
            patient_id,
            subject_table="patient_documents",
            subject_id=document_id,
            meta={"opened": "patient_document"},
        )
    return url


def formulary(query: str) -> list[dict[str, Any]]:
    return clinical_repo.search_formulary(query)


def _body_medicines(medicines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "medicineId": m.get("medicineId"),
            "name": m["name"],
            "strength": _blank_to_null(m.get("strength")),
            "schedule": _blank_to_null(m.get("schedule")),
            "durationDays": m.get("durationDays"),
            "instructionBn": _blank_to_null(m.get("instructionBn")),
        }
        for m in medicines
    ]


def _matches_content(body: dict[str, Any], visit: dict[str, Any]) -> bool:
    medicines = body.get("medicines")
    same_medicines = medicines is None or _body_medicines(medicines) == visit["medicines"]
    return (
        same_medicines
        and visit["diagnosisText"] == _blank_to_null(body.get("diagnosisText"))
        and visit["adviceTextBn"] == _blank_to_null(body.get("adviceTextBn"))
        and visit["followUpDate"] == body.get("followUpDate")
        and visit["symptomSignal"] == body.get("symptomSignal")
    )


def _assert_doctor(principal: Any, hospital_id: str) -> None:
    if principal.kind != "staff":
        raise forbidden_scope({"reason": "staff_only"})
    if "doctor" not in principal.roles:
        raise forbidden_scope({"reason": "role_not_permitted"})
    if principal.hospital_id != hospital_id:
        raise forbidden_scope({"reason": "hospital_scope"})


def consultation(principal: Any, booking_id: str) -> dict[str, Any]:
    booking = clinical_repo.find_chamber_booking(booking_id)
    if booking is None:
        raise not_found("booking")
    _assert_doctor(principal, booking["hospitalId"])
    with db.transaction():
        if session_repo.lock_for_update(booking["sessionId"]) is None:
            raise not_found("session")
        visit = clinical_repo.read_draft(booking_id)
    _audit(
        principal,
        booking["patientId"],
        subject_table="visits",
        subject_id=None if visit is None else visit["visitId"],
        meta={"bookingId": booking_id, "opened": "consultation_draft"},
    )
    return {
        "bookingId": booking_id,
        "patientId": booking["patientId"],
        "sessionId": booking["sessionId"],
        "hospitalId": booking["hospitalId"],
        "visit": visit,
    }


def save_visit(*, principal: Any, actor: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    booking = clinical_repo.find_chamber_booking(body["bookingId"])
    if booking is None:
        raise not_found("booking")
    if principal.kind != "staff":
        raise forbidden_scope({"reason": "staff_only"})
    if "doctor" not in principal.roles:
        raise forbidden_scope({"reason": "role_not_permitted"})
    if principal.hospital_id != booking["hospitalId"]:
        raise forbidden_scope({"reason": "hospital_scope"})
    if (body.get("patientId") is not None and body["patientId"] != booking["patientId"]) or (
        body.get("sessionId") is not None and body["sessionId"] != booking["sessionId"]
    ):
        raise forbidden_scope({"reason": "consultation_identity"})
    staff_user_id = principal.id
    sign = body["sign"]

    with db.transaction():
        if session_repo.lock_for_update(booking["sessionId"]) is None:
            raise not_found("session")
        current = clinical_repo.find_chamber_booking(booking["bookingId"])
        if current is None:
            raise not_found("booking")
        previous = clinical_repo.read_draft(booking["bookingId"])
        if previous is not None and previous["signedAt"] is not None:
            if not sign:
                raise guard_failed("VISIT_ALREADY_SIGNED", "A signed visit cannot be changed.")
            visit = previous
        else:
            if sign and current["status"] != "in_chamber":
                raise guard_failed("PATIENT_NOT_IN_CHAMBER", "Only the current encounter may be signed.")
            expected = body.get("expectedRevision")
            if expected != (None if previous is None else previous["revision"]):
                if not sign and previous is not None and _matches_content(body, previous):
                    visit = previous
                else:
                    raise guard_failed(
                        "VISIT_REVISION_CONFLICT",
                        "Another device changed the draft. Read and review it before saving.",
                    )
            else:
                written = clinical_repo.upsert_visit(
                    {
                        "bookingId": booking["bookingId"],
                        "patientId": booking["patientId"],
                        "hospitalId": booking["hospitalId"],
                        "doctorId": booking["doctorId"],
                        "diagnosisText": _blank_to_null(body.get("diagnosisText")),
                        "adviceTextBn": _blank_to_null(body.get("adviceTextBn")),
                        "followUpDate": body.get("followUpDate"),
                        "symptomSignal": body.get("symptomSignal"),
                        "sign": sign,
                        "staffUserId": staff_user_id,
                    }
                )
                if not written["alreadySigned"] and body.get("medicines") is not None:
                    clinical_repo.replace_medicines(
                        visit_id=written["id"],
                        staff_user_id=staff_user_id,
                        medicines=_body_medicines(body["medicines"]),
                    )
                saved = clinical_repo.read_draft(booking["bookingId"])
                if saved is None:
                    raise RuntimeError("saved consultation missing")
                visit = saved

    result = {
        "visitId": visit["visitId"],
        "revision": visit["revision"],
        "contentMatches": _matches_content(body, visit),
    }
    if not sign:
        return {**result, "signed": False, "queue": None, "queueOutcome": "not_requested"}
    try:
        queue = queue_service.call_next(
            session_id=booking["sessionId"],
            expected_booking_id=booking["bookingId"],
            actor=actor,
            client_event_id=visit["visitId"],
        )
        return {**result, "signed": True, "queue": queue, "queueOutcome": "advanced"}
    except Exception as error:
        changed = isinstance(error, AppError) and (error.details or {}).get("guard") == "CONSULTATION_CHANGED"
        if not changed:
            logger.warn(
                {"code": error.code if isinstance(error, AppError) else "QUEUE_WRITE_FAILED"},
                "signed record queue advancement needs reconciliation",
            )
        return {**result, "signed": True, "queue": None, "queueOutcome": "changed" if changed else "retry_needed"}
