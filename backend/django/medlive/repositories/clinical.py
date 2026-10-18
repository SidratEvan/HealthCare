"""Visits, prescriptions, consents, the record-view audit and patients' own papers
(port of `repositories/clinical.repo.ts`; FR-DOC-*, FR-PAT-6x)."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from ..core import db
from ..core.http import dumps
from ..core.schema import js_trim
from ..domain.time import from_datetime


def _iso(value: Any) -> str | None:
    return None if value is None else from_datetime(value)


def _as_text(value: Any) -> str | None:
    return value if isinstance(value, str) and js_trim(value) != "" else None


def _as_list(value: Any) -> list[str]:
    return [entry for entry in value if isinstance(entry, str)] if isinstance(value, list) else []


def _date_only(value: Any) -> str:
    return str(value)[:10]


def find_patient(patient_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT id, full_name, age_years, sex::text AS sex, blood_group
          FROM patients WHERE id = %s::uuid AND deleted_at IS NULL
        """,
        [patient_id],
    )
    if row is None:
        return None
    return {
        "id": row["id"],
        "fullName": row["full_name"],
        "ageYears": row["age_years"],
        "sex": row["sex"],
        "bloodGroup": row["blood_group"],
    }


def find_chamber_booking(booking_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT b.id AS booking_id, b.patient_id, b.session_id,
               s.hospital_id, s.doctor_id,
               b.serial_number, b.status::text AS status, b.fee_poisha
          FROM bookings b
          JOIN sessions s ON s.id = b.session_id
         WHERE b.id = %s::uuid AND b.deleted_at IS NULL
        """,
        [booking_id],
    )
    if row is None:
        return None
    return {
        "bookingId": row["booking_id"],
        "patientId": row["patient_id"],
        "sessionId": row["session_id"],
        "hospitalId": row["hospital_id"],
        "doctorId": row["doctor_id"],
        "serial": row["serial_number"],
        "status": row["status"],
        "feePoisha": row["fee_poisha"],
    }


def find_intake(booking_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        "SELECT intake, reason_text FROM bookings WHERE id = %s::uuid AND deleted_at IS NULL", [booking_id]
    )
    if row is None:
        return None
    intake = row["intake"] or {}
    answered = [key for key in intake if key != "demo"]
    complaint = _as_text(intake.get("complaintBn"))
    return {
        "complaintBn": complaint if complaint is not None else row["reason_text"],
        "durationBn": _as_text(intake.get("durationBn")),
        "conditionsBn": _as_list(intake.get("conditionsBn")),
        "medicinesBn": _as_list(intake.get("medicinesBn")),
        "allergiesBn": _as_list(intake.get("allergiesBn")),
        "asked": len(answered) > 0,
    }


_VISIT_SELECT = """
    SELECT v.id, v.booking_id, v.diagnosis_text, v.advice_text_bn,
           v.follow_up_date, v.signed_at,
           d.full_name_bn  AS doctor_name_bn,
           d.full_name_en  AS doctor_name_en,
           d.bmdc_number   AS doctor_bmdc,
           dep.name_bn     AS department_name_bn,
           dep.name_en     AS department_name_en,
           h.name_bn       AS hospital_name_bn,
           h.name_en       AS hospital_name_en,
           b.serial_number,
           coalesce(v.signed_at, v.created_at) AS visited_at
      FROM visits v
      JOIN bookings b       ON b.id = v.booking_id
      JOIN sessions sess    ON sess.id = b.session_id
      JOIN departments dep  ON dep.id = sess.department_id
      JOIN doctors d        ON d.id = v.doctor_id
      JOIN hospitals h      ON h.id = v.hospital_id
"""


def _to_visit(row: dict[str, Any], medicines: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "bookingId": row["booking_id"],
        "diagnosisText": row["diagnosis_text"],
        "adviceTextBn": row["advice_text_bn"],
        "followUpDate": None if row["follow_up_date"] is None else _date_only(row["follow_up_date"]),
        "signedAt": _iso(row["signed_at"]),
        "doctorNameBn": row["doctor_name_bn"],
        "doctorNameEn": row["doctor_name_en"],
        "departmentNameBn": row["department_name_bn"],
        "departmentNameEn": row["department_name_en"],
        "hospitalNameBn": row["hospital_name_bn"],
        "hospitalNameEn": row["hospital_name_en"],
        "serial": row["serial_number"],
        "visitedAt": from_datetime(row["visited_at"]),
        "doctorBmdc": row["doctor_bmdc"],
        "medicines": medicines,
    }


def find_visits(patient_id: str, hospital_id: str | None, limit: int = 20) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        _VISIT_SELECT
        + """
         WHERE v.patient_id = %(patient)s::uuid
           AND (%(hospital)s::uuid IS NULL OR v.hospital_id = %(hospital)s::uuid)
           AND v.deleted_at IS NULL
           AND v.signed_at IS NOT NULL
         ORDER BY v.signed_at DESC
         LIMIT %(limit)s
        """,
        {"patient": patient_id, "hospital": hospital_id, "limit": limit},
    )
    medicines = medicines_for([r["id"] for r in rows])
    return [_to_visit(r, medicines.get(r["id"], [])) for r in rows]


def find_visit_by_booking(booking_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        "SELECT id, signed_at FROM visits WHERE booking_id = %s::uuid AND deleted_at IS NULL", [booking_id]
    )
    return None if row is None else {"id": row["id"], "signedAt": _iso(row["signed_at"])}


def read_draft(booking_id: str) -> dict[str, Any] | None:
    """The doctor's draft and a revision that changes whenever any of it does."""
    row = db.fetch_one(
        """
        SELECT id, id::text || ':' || updated_at::text AS revision, signed_at,
               diagnosis_text, advice_text_bn, follow_up_date::text AS follow_up_date, symptom_signal
          FROM visits WHERE booking_id = %s::uuid AND deleted_at IS NULL
        """,
        [booking_id],
    )
    if row is None:
        return None
    medicines = medicines_for([row["id"]]).get(row["id"], [])
    digest = hashlib.sha256(dumps({"row": row, "medicines": medicines}).encode("utf8")).hexdigest()
    return {
        "visitId": row["id"],
        "revision": f"{row['revision']}:{digest}",
        "signedAt": _iso(row["signed_at"]),
        "diagnosisText": row["diagnosis_text"],
        "adviceTextBn": row["advice_text_bn"],
        "followUpDate": row["follow_up_date"],
        "symptomSignal": row["symptom_signal"],
        "medicines": medicines,
    }


def _exists(sql: str, params: list[Any]) -> bool:
    return bool(db.fetch_value(sql, params))


def patient_belongs_to_user(patient_id: str, user_id: str) -> bool:
    return _exists(
        """
        SELECT EXISTS (
          SELECT 1 FROM patients
           WHERE id = %s::uuid AND owner_user_id = %s::uuid AND deleted_at IS NULL
        ) AS ok
        """,
        [patient_id, user_id],
    )


def treated_at_hospital(hospital_id: str, patient_id: str) -> bool:
    return _exists(
        """
        SELECT EXISTS (
          SELECT 1
            FROM bookings b
            JOIN sessions s ON s.id = b.session_id
           WHERE b.patient_id = %s::uuid
             AND s.hospital_id = %s::uuid
             AND b.deleted_at IS NULL
             AND s.deleted_at IS NULL
        ) AS ok
        """,
        [patient_id, hospital_id],
    )


def has_live_consent(patient_id: str, hospital_id: str) -> bool:
    return _exists(
        """
        SELECT EXISTS (
          SELECT 1
            FROM consents c
           WHERE c.patient_id = %s::uuid
             AND c.hospital_id = %s::uuid
             AND c.revoked_at IS NULL
             AND c.deleted_at IS NULL
             AND (c.expires_at IS NULL OR c.expires_at > now())
        ) AS ok
        """,
        [patient_id, hospital_id],
    )


def upsert_visit(write: dict[str, Any]) -> dict[str, Any]:
    """Writes the draft, or signs it; a signed visit is never changed again."""
    row = db.fetch_one(
        f"""
        INSERT INTO visits
          (booking_id, patient_id, hospital_id, doctor_id,
           diagnosis_text, advice_text_bn, follow_up_date, symptom_signal,
           signed_at, created_by)
        VALUES (%s::uuid, %s::uuid, %s::uuid, %s::uuid, %s, %s, %s::date, %s::symptom_signal,
                {"now()" if write["sign"] else "NULL"}, %s::uuid)
        ON CONFLICT (booking_id) DO UPDATE
           SET diagnosis_text = EXCLUDED.diagnosis_text,
               advice_text_bn = EXCLUDED.advice_text_bn,
               follow_up_date = EXCLUDED.follow_up_date,
               symptom_signal = EXCLUDED.symptom_signal,
               signed_at      = EXCLUDED.signed_at
         WHERE visits.signed_at IS NULL
        RETURNING id
        """,
        [
            write["bookingId"],
            write["patientId"],
            write["hospitalId"],
            write["doctorId"],
            write["diagnosisText"],
            write["adviceTextBn"],
            write["followUpDate"],
            write["symptomSignal"],
            write["staffUserId"],
        ],
    )
    if row is not None:
        return {"id": row["id"], "alreadySigned": False}
    existing = db.fetch_value(
        "SELECT id FROM visits WHERE booking_id = %s::uuid AND signed_at IS NOT NULL", [write["bookingId"]]
    )
    if existing is None:
        raise RuntimeError("visit upsert returned no row.")
    return {"id": existing, "alreadySigned": True}


def record_record_view(
    *,
    staff_user_id: str | None,
    user_id: str | None,
    hospital_id: str | None,
    patient_id: str | None,
    subject_table: str,
    subject_id: str | None,
    meta: dict[str, Any],
) -> None:
    """Every read of a record is audited (FR-SEC-03, FR-PAT-64)."""
    db.execute(
        """
        INSERT INTO audit_log
          (actor_staff_id, actor_user_id, hospital_id, action,
           subject_table, subject_id, patient_id, meta)
        VALUES (%s::uuid, %s::uuid, %s::uuid, 'RECORD_VIEW', %s, %s::uuid, %s::uuid, %s::jsonb)
        """,
        [
            staff_user_id,
            user_id,
            hospital_id,
            subject_table,
            subject_id,
            patient_id,
            json.dumps(meta, ensure_ascii=False, separators=(",", ":")),
        ],
    )


def grant_consent(
    *,
    patient_id: str,
    hospital_id: str,
    doctor_id: str | None,
    scope: str,
    expires_at: str | None,
    granted_via: str,
    staff_user_id: str | None,
) -> dict[str, Any]:
    found = db.fetch_value(
        """
        SELECT id FROM consents
         WHERE patient_id = %s::uuid
           AND hospital_id = %s::uuid
           AND scope = %s::consent_scope
           AND revoked_at IS NULL
           AND deleted_at IS NULL
           AND (expires_at IS NULL OR expires_at > now())
         LIMIT 1
        """,
        [patient_id, hospital_id, scope],
    )
    if found is not None:
        db.execute("UPDATE consents SET expires_at = %s::timestamptz WHERE id = %s::uuid", [expires_at, found])
        return {"id": found, "reused": True}
    consent_id = db.fetch_value(
        """
        INSERT INTO consents
          (patient_id, hospital_id, doctor_id, scope, expires_at, granted_via, created_by)
        VALUES (%s::uuid, %s::uuid, %s::uuid, %s::consent_scope, %s::timestamptz, %s, %s::uuid)
        RETURNING id
        """,
        [patient_id, hospital_id, doctor_id, scope, expires_at, granted_via, staff_user_id],
    )
    if consent_id is None:
        raise RuntimeError("consent insert returned no row.")
    return {"id": consent_id, "reused": False}


def revoke_consent(consent_id: str, patient_id: str) -> bool:
    rows = db.fetch_all(
        """
        UPDATE consents SET revoked_at = now()
         WHERE id = %s::uuid AND patient_id = %s::uuid AND revoked_at IS NULL AND deleted_at IS NULL
        RETURNING id
        """,
        [consent_id, patient_id],
    )
    return len(rows) > 0


def find_primary_patient(user_id: str) -> str | None:
    return db.fetch_value(
        """
        SELECT id FROM patients
         WHERE owner_user_id = %s::uuid AND deleted_at IS NULL
         ORDER BY is_primary DESC, created_at
         LIMIT 1
        """,
        [user_id],
    )


def find_consent_patient(consent_id: str) -> str | None:
    return db.fetch_value(
        "SELECT patient_id FROM consents WHERE id = %s::uuid AND deleted_at IS NULL", [consent_id]
    )


def list_consents(patient_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT c.id, c.hospital_id,
               h.name_bn AS hospital_name_bn, h.name_en AS hospital_name_en,
               c.scope::text AS scope, c.granted_at, c.expires_at, c.revoked_at, c.granted_via
          FROM consents c
          JOIN hospitals h ON h.id = c.hospital_id
         WHERE c.patient_id = %s::uuid AND c.deleted_at IS NULL
         ORDER BY c.granted_at DESC
        """,
        [patient_id],
    )
    return [
        {
            "id": r["id"],
            "hospitalId": r["hospital_id"],
            "hospitalNameBn": r["hospital_name_bn"],
            "hospitalNameEn": r["hospital_name_en"],
            "scope": r["scope"],
            "grantedAt": from_datetime(r["granted_at"]),
            "expiresAt": _iso(r["expires_at"]),
            "revokedAt": _iso(r["revoked_at"]),
            "grantedVia": r["granted_via"],
        }
        for r in rows
    ]


def list_access_log(patient_id: str, limit: int = 50) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT a.created_at,
               h.name_bn AS hospital_name_bn, h.name_en AS hospital_name_en,
               su.full_name AS staff_name, a.action
          FROM audit_log a
          LEFT JOIN hospitals h    ON h.id = a.hospital_id
          LEFT JOIN staff_users su ON su.id = a.actor_staff_id
         WHERE a.patient_id = %s::uuid
           AND a.action = 'RECORD_VIEW'
           AND a.actor_staff_id IS NOT NULL
         ORDER BY a.created_at DESC
         LIMIT %s
        """,
        [patient_id, limit],
    )
    return [
        {
            "at": from_datetime(r["created_at"]),
            "hospitalNameBn": r["hospital_name_bn"],
            "hospitalNameEn": r["hospital_name_en"],
            "staffName": r["staff_name"],
            "action": r["action"],
        }
        for r in rows
    ]


def find_visit_for_booking(booking_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        _VISIT_SELECT
        + """
         WHERE v.booking_id = %s::uuid AND v.deleted_at IS NULL AND v.signed_at IS NOT NULL
        """,
        [booking_id],
    )
    if row is None:
        return None
    return _to_visit(row, medicines_for([row["id"]]).get(row["id"], []))


def medicines_for(visit_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    found: dict[str, list[dict[str, Any]]] = {}
    if not visit_ids:
        return found
    rows = db.fetch_all(
        """
        SELECT p.visit_id, i.medicine_id, i.name_text, i.strength, i.schedule,
               i.duration_days, i.instruction_bn
          FROM prescriptions p
          JOIN prescription_items i ON i.prescription_id = p.id
         WHERE p.visit_id = ANY(%s::uuid[])
           AND p.deleted_at IS NULL
           AND i.deleted_at IS NULL
         ORDER BY i.created_at, i.id
        """,
        [list(visit_ids)],
    )
    for r in rows:
        found.setdefault(r["visit_id"], []).append(
            {
                "medicineId": r["medicine_id"],
                "name": r["name_text"],
                "strength": r["strength"],
                "schedule": r["schedule"],
                "durationDays": r["duration_days"],
                "instructionBn": r["instruction_bn"],
            }
        )
    return found


def replace_medicines(*, visit_id: str, staff_user_id: str | None, medicines: list[dict[str, Any]]) -> None:
    db.execute(
        """
        DELETE FROM prescription_items
         WHERE prescription_id IN (SELECT id FROM prescriptions WHERE visit_id = %s::uuid)
        """,
        [visit_id],
    )
    if not medicines:
        db.execute("DELETE FROM prescriptions WHERE visit_id = %s::uuid", [visit_id])
        return
    prescription_id = db.fetch_value(
        """
        INSERT INTO prescriptions (visit_id, created_by) VALUES (%s::uuid, %s::uuid)
        ON CONFLICT (visit_id) DO UPDATE SET updated_at = now()
        RETURNING id
        """,
        [visit_id, staff_user_id],
    )
    if prescription_id is None:
        raise RuntimeError("prescription upsert returned no row.")
    for index, medicine in enumerate(medicines):
        db.execute(
            """
            INSERT INTO prescription_items
              (prescription_id, medicine_id, name_text, strength, schedule, duration_days,
               instruction_bn, created_at)
            VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, %s, now() + %s::int * interval '1 microsecond')
            """,
            [
                prescription_id,
                medicine["medicineId"],
                medicine["name"],
                medicine["strength"],
                medicine["schedule"],
                medicine["durationDays"],
                medicine["instructionBn"],
                index,
            ],
        )


def search_formulary(query: str, limit: int = 10) -> list[dict[str, Any]]:
    prefix = re.sub(r"[\\%_]", lambda m: "\\" + m.group(0), query.lower()) + "%"
    rows = db.fetch_all(
        """
        SELECT id, generic_name, brand_name, form, strengths
          FROM medicines
         WHERE deleted_at IS NULL
           AND (lower(generic_name) LIKE %s OR lower(brand_name) LIKE %s)
         ORDER BY generic_name, brand_name NULLS LAST
         LIMIT %s
        """,
        [prefix, prefix, limit],
    )
    return [
        {
            "id": r["id"],
            "genericName": r["generic_name"],
            "brandName": r["brand_name"],
            "form": r["form"],
            "strengths": r["strengths"],
        }
        for r in rows
    ]


def insert_document(
    *,
    document_id: str,
    patient_id: str,
    key: str,
    doc_type: str,
    doc_date: str | None,
    doctor_name: str | None,
    content_type: str,
    byte_size: int,
    user_id: str,
) -> dict[str, Any]:
    uploaded_at = db.fetch_value(
        """
        INSERT INTO patient_documents
          (id, patient_id, file_url, doc_type, doc_date, doctor_name_text, content_type,
           byte_size, uploaded_by_user)
        VALUES (%s::uuid, %s::uuid, %s, %s, %s::date, %s, %s, %s, %s::uuid)
        RETURNING uploaded_at
        """,
        [document_id, patient_id, key, doc_type, doc_date, doctor_name, content_type, byte_size, user_id],
    )
    if uploaded_at is None:
        raise RuntimeError("document insert returned no row.")
    return {
        "id": document_id,
        "docType": doc_type,
        "docDate": doc_date,
        "doctorName": doctor_name,
        "contentType": content_type,
        "byteSize": byte_size,
        "uploadedAt": from_datetime(uploaded_at),
        "source": "patient_provided",
    }


def list_documents(patient_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT id, doc_type, doc_date, doctor_name_text, content_type, byte_size, uploaded_at
          FROM patient_documents
         WHERE patient_id = %s::uuid AND deleted_at IS NULL
         ORDER BY coalesce(doc_date, uploaded_at::date) DESC, uploaded_at DESC
         LIMIT 100
        """,
        [patient_id],
    )
    return [
        {
            "id": r["id"],
            "docType": r["doc_type"],
            "docDate": None if r["doc_date"] is None else _date_only(r["doc_date"]),
            "doctorName": r["doctor_name_text"],
            "contentType": r["content_type"],
            "byteSize": r["byte_size"],
            "uploadedAt": from_datetime(r["uploaded_at"]),
            "source": "patient_provided",
        }
        for r in rows
    ]


def find_document(document_id: str) -> dict[str, str] | None:
    row = db.fetch_one(
        "SELECT patient_id, file_url FROM patient_documents WHERE id = %s::uuid AND deleted_at IS NULL", [document_id]
    )
    return None if row is None else {"patientId": row["patient_id"], "key": row["file_url"]}


def remove_document(document_id: str) -> bool:
    return (
        db.execute(
            "UPDATE patient_documents SET deleted_at = now() WHERE id = %s::uuid AND deleted_at IS NULL", [document_id]
        )
        > 0
    )
