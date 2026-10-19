"""A patient's consent to a hospital reading their records (port of `services/consent.service.ts`; FR-PAT-63, FR-PAT-64, FR-SEC-04).

The patient shows a short-lived code in the chamber; a doctor who scans it
opens the patient's records to their hospital for a day. A patient may also
grant or revoke consent from the app, and sees every staff read of their
records.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from ..core import db
from ..core.env import env
from ..core.errors import AppError, forbidden_scope, not_found
from ..core.jwt import sign_token, verify_token
from ..domain.schemas.clinical import CONSENT_OFFER_TTL_SECONDS
from ..domain.time import from_datetime, utc_now
from ..repositories import clinical as clinical_repo

CONSENT_TTL_HOURS = 24


def _expires_at() -> str:
    return from_datetime(utc_now() + timedelta(hours=CONSENT_TTL_HOURS))


def offer_consent(*, principal: Any, patient_id: str) -> dict[str, Any]:
    if clinical_repo.find_patient(patient_id) is None:
        raise not_found("patient")
    _assert_speaks_for(principal, patient_id)
    token = sign_token("consent", {"sub": patient_id, "kind": "patient"})
    return {"code": token, "expiresInSeconds": CONSENT_OFFER_TTL_SECONDS, "grantHours": CONSENT_TTL_HOURS}


def redeem_consent(*, principal: Any, code: str) -> dict[str, Any]:
    if principal.kind != "staff":
        raise forbidden_scope({"reason": "staff_only"})
    if "doctor" not in principal.roles:
        raise forbidden_scope({"reason": "role_not_permitted"})
    verified = verify_token(code, "consent")
    if not verified.ok:
        raise AppError("CONSENT_CODE_INVALID", message="That code has expired or is not valid.")
    patient_id = verified.claims["sub"]
    patient = clinical_repo.find_patient(patient_id)
    if patient is None:
        raise not_found("patient")
    expires_at = _expires_at()
    hospital_id = principal.hospital_id
    staff_user_id = principal.id
    with db.transaction():
        granted = clinical_repo.grant_consent(
            patient_id=patient_id,
            hospital_id=hospital_id,
            doctor_id=None,
            scope="hospital",
            expires_at=expires_at,
            granted_via="qr",
            staff_user_id=staff_user_id,
        )
    clinical_repo.record_record_view(
        staff_user_id=staff_user_id,
        user_id=None,
        hospital_id=hospital_id,
        patient_id=patient_id,
        subject_table="consents",
        subject_id=granted["id"],
        meta={"grantedVia": "qr", "reused": granted["reused"], "expiresAt": expires_at},
    )
    return {
        "consentId": granted["id"],
        "patientId": patient_id,
        "patientName": patient["fullName"],
        "expiresAt": expires_at,
    }


def grant_direct(*, principal: Any, hospital_id: str, scope: str) -> dict[str, Any]:
    if principal.kind != "patient":
        raise forbidden_scope({"reason": "patient_only"})
    patient_id = _primary_patient_of(principal.id)
    expires_at = _expires_at()
    with db.transaction():
        granted = clinical_repo.grant_consent(
            patient_id=patient_id,
            hospital_id=hospital_id,
            doctor_id=None,
            scope=scope,
            expires_at=expires_at,
            granted_via="app",
            staff_user_id=None,
        )
    return {"consentId": granted["id"], "expiresAt": expires_at}


def revoke_consent(*, principal: Any, consent_id: str) -> None:
    patient_id = clinical_repo.find_consent_patient(consent_id)
    if patient_id is None:
        raise not_found("consent")
    _assert_speaks_for(principal, patient_id)
    if not clinical_repo.revoke_consent(consent_id, patient_id):
        raise not_found("consent")


def _primary_patient_of(user_id: str) -> str:
    patient_id = clinical_repo.find_primary_patient(user_id)
    if patient_id is None:
        raise not_found("patient")
    return patient_id


def list_consents(*, principal: Any, patient_id: str) -> list[dict[str, Any]]:
    _assert_speaks_for(principal, patient_id)
    return clinical_repo.list_consents(patient_id)


def access_log(*, principal: Any, patient_id: str) -> list[dict[str, Any]]:
    _assert_speaks_for(principal, patient_id)
    return clinical_repo.list_access_log(patient_id)


def _assert_speaks_for(principal: Any, patient_id: str) -> None:
    if principal.kind == "patient":
        if not clinical_repo.patient_belongs_to_user(patient_id, principal.id):
            raise forbidden_scope({"reason": "not_your_record"})
        return
    if principal.kind == "guest":
        if not env().DEMO_MODE:
            raise forbidden_scope({"reason": "patient_only"})
        if principal.booking_id is None:
            raise forbidden_scope({"reason": "link_has_no_booking"})
        booking = clinical_repo.find_chamber_booking(principal.booking_id)
        if booking is None:
            raise not_found("booking")
        if booking["patientId"] != patient_id:
            raise forbidden_scope({"reason": "booking_patient"})
        return
    raise forbidden_scope({"reason": "patient_only"})
