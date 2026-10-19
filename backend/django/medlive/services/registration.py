"""Registering a person at the counter (port of `services/registration.service.ts`; S-B-03, FR-REC-14, FR-REC-20).

Looking a phone up shows only the people this hospital has seen under it,
and every lookup that shows someone is audited.
"""

from __future__ import annotations

from typing import Any

from ..core import db
from ..core.errors import validation_failed
from ..domain.phone import normalise_bd_mobile
from ..repositories import guest as guest_repo
from ..repositories import registration as registration_repo


def _phone_of(typed: str) -> str:
    phone = normalise_bd_mobile(typed)
    if phone is None:
        raise validation_failed({"field": "phone", "reason": "not_bd_mobile"})
    return phone


def lookup(actor: dict[str, Any], typed_phone: str) -> dict[str, Any]:
    phone = _phone_of(typed_phone)
    patients = registration_repo.patients_for_phone(phone, actor["hospitalId"])
    if patients:
        with db.transaction():
            registration_repo.record_lookup(
                actor_staff_id=actor["staffId"],
                hospital_id=actor["hospitalId"],
                patient_ids=[patient["patientId"] for patient in patients],
                ip=actor["ip"],
                user_agent=actor["userAgent"],
            )
    return {"phone": phone, "patients": patients}


def register(body: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
    phone = _phone_of(body["phone"])
    with db.transaction():
        guest_id = guest_repo.find_or_create_identity(phone=phone, display_name=body["fullName"])
        existing = registration_repo.guest_name_count(guest_id, body["fullName"])
        patient_id = guest_repo.find_or_create_patient(
            guest_id=guest_id, full_name=body["fullName"], age_years=body["ageYears"], sex=body["sex"], phone=phone
        )
        if existing > 0:
            registration_repo.record_lookup(
                actor_staff_id=actor["staffId"],
                hospital_id=actor["hospitalId"],
                patient_ids=[patient_id],
                ip=actor["ip"],
                user_agent=actor["userAgent"],
            )
        return {
            "patientId": patient_id,
            "phone": phone,
            "created": existing == 0,
            "ambiguous": existing > 1,
            "patient": registration_repo.registered_patient(patient_id),
        }
