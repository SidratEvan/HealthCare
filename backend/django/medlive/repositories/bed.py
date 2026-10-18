"""Wards, beds, admissions, bed requests and the public capacity mirror
(port of `repositories/bed.repo.ts`; FR-BED-*, FR-PAT-52)."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from ..core import db
from ..domain.time import from_datetime, from_epoch_ms, parse_ms


def _iso(value: datetime | None) -> str | None:
    return None if value is None else from_datetime(value)


_BED_SELECT = """
  b.id, b.hospital_id, b.ward_id, b.label, b.kind::text AS kind, b.state::text AS state,
  b.nightly_poisha, b.last_cleaned_at, b.state_changed_at,
  b.expected_discharge_date::text AS expected_discharge_date,
  b.reserved_until, b.oos_reason, b.current_admission_id, b.version::text AS version,
  (SELECT r.id FROM bed_requests r
    WHERE r.bed_id = b.id AND r.state = 'held' AND r.deleted_at IS NULL
    LIMIT 1) AS held_for_request_id
"""


def _to_bed(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r["id"],
        "hospitalId": r["hospital_id"],
        "wardId": r["ward_id"],
        "label": r["label"],
        "kind": r["kind"],
        "state": r["state"],
        "nightlyPoisha": r["nightly_poisha"],
        "lastCleanedAt": _iso(r["last_cleaned_at"]),
        "stateChangedAt": from_datetime(r["state_changed_at"]),
        "expectedDischargeDate": r["expected_discharge_date"],
        "reservedUntil": _iso(r["reserved_until"]),
        "oosReason": r["oos_reason"],
        "admissionId": r["current_admission_id"],
        "heldForRequestId": r["held_for_request_id"],
        "version": int(r["version"]),
    }


def list_wards(hospital_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT id, name_bn, name_en, floor, kind::text AS kind
          FROM wards
         WHERE hospital_id = %s::uuid AND deleted_at IS NULL
         ORDER BY floor, name_en
        """,
        [hospital_id],
    )
    return [
        {"id": r["id"], "nameBn": r["name_bn"], "nameEn": r["name_en"], "floor": r["floor"], "kind": r["kind"]}
        for r in rows
    ]


def list_beds(hospital_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        f"SELECT {_BED_SELECT} FROM beds b WHERE b.hospital_id = %s::uuid AND b.deleted_at IS NULL ORDER BY b.label",
        [hospital_id],
    )
    return [_to_bed(r) for r in rows]


def find_bed(bed_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(f"SELECT {_BED_SELECT} FROM beds b WHERE b.id = %s::uuid AND b.deleted_at IS NULL", [bed_id])
    return None if row is None else _to_bed(row)


def lock_beds(bed_ids: list[str]) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        f"""
        SELECT {_BED_SELECT}
          FROM beds b
         WHERE b.id = ANY(%s::uuid[]) AND b.deleted_at IS NULL
         ORDER BY b.id
           FOR UPDATE OF b
        """,
        [list(bed_ids)],
    )
    return [_to_bed(r) for r in rows]


def lock_lapsed_holds(hospital_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        f"""
        SELECT {_BED_SELECT}
          FROM beds b
         WHERE b.hospital_id = %s::uuid
           AND b.state = 'reserved'
           AND b.reserved_until <= now()
           AND b.deleted_at IS NULL
           FOR UPDATE OF b SKIP LOCKED
        """,
        [hospital_id],
    )
    return [_to_bed(r) for r in rows]


def write_bed(bed_id: str, write: dict[str, Any]) -> None:
    db.execute(
        """
        UPDATE beds
           SET state                   = %s::bed_state,
               current_admission_id    = %s::uuid,
               expected_discharge_date = %s::date,
               reserved_until          = %s,
               oos_reason              = %s,
               last_cleaned_at         = CASE WHEN %s THEN now() ELSE last_cleaned_at END,
               state_changed_at        = now()
         WHERE id = %s::uuid
        """,
        [
            write["state"],
            write["admissionId"],
            write["expectedDischargeDate"],
            write["reservedUntil"],
            write["oosReason"],
            write.get("cleaned") is True,
            bed_id,
        ],
    )


def write_discharge_forecast(*, bed_id: str, admission_id: str, date: str | None) -> None:
    db.execute("UPDATE beds SET expected_discharge_date = %s::date WHERE id = %s::uuid", [date, bed_id])
    db.execute("UPDATE admissions SET expected_discharge_date = %s::date WHERE id = %s::uuid", [date, admission_id])


def append_event(event: dict[str, Any]) -> dict[str, str]:
    row = db.fetch_one(
        """
        INSERT INTO bed_events
          (hospital_id, bed_id, type, from_state, to_state, admission_id, bed_request_id,
           actor_staff_id, payload, client_event_id, client_ts)
        VALUES (%s::uuid, %s::uuid, %s, %s::bed_state, %s::bed_state, %s::uuid, %s::uuid, %s::uuid,
                %s::jsonb, %s::uuid, %s::timestamptz)
        RETURNING id, server_ts
        """,
        [
            event["hospitalId"],
            event["bedId"],
            event["type"],
            event["from"],
            event["to"],
            event["admissionId"],
            event["bedRequestId"],
            event["actorStaffId"],
            json.dumps(event["payload"], ensure_ascii=False, separators=(",", ":")),
            event["clientEventId"],
            event["clientTs"],
        ],
    )
    if row is None:
        raise RuntimeError("bed_events insert returned no row.")
    return {"id": row["id"], "serverTs": from_datetime(row["server_ts"])}


def find_replay(client_event_id: str) -> dict[str, str] | None:
    row = db.fetch_one(
        "SELECT bed_id, hospital_id, server_ts FROM bed_events WHERE client_event_id = %s::uuid", [client_event_id]
    )
    if row is None:
        return None
    return {"bedId": row["bed_id"], "hospitalId": row["hospital_id"], "serverTs": from_datetime(row["server_ts"])}


def lock_patient_for_admit(patient_id: str) -> dict[str, Any]:
    locked = db.fetch_one(
        "SELECT id FROM patients WHERE id = %s::uuid AND deleted_at IS NULL FOR UPDATE", [patient_id]
    )
    if locked is None:
        return {"exists": False, "openAdmissionBedId": None}
    open_bed = db.fetch_value(
        "SELECT bed_id FROM admissions WHERE patient_id = %s::uuid AND discharged_at IS NULL AND deleted_at IS NULL",
        [patient_id],
    )
    return {"exists": True, "openAdmissionBedId": open_bed}


def insert_admission(
    *,
    patient_id: str,
    hospital_id: str,
    bed_id: str,
    source: str,
    bed_request_id: str | None,
    emergency_case_id: str | None,
    expected_discharge_date: str | None,
    created_by: str,
) -> str:
    admission = db.fetch_value(
        """
        INSERT INTO admissions
          (patient_id, hospital_id, bed_id, source, bed_request_id, emergency_case_id,
           expected_discharge_date, created_by)
        VALUES (%s::uuid, %s::uuid, %s::uuid, %s, %s::uuid, %s::uuid, %s::date, %s::uuid)
        RETURNING id
        """,
        [patient_id, hospital_id, bed_id, source, bed_request_id, emergency_case_id, expected_discharge_date, created_by],
    )
    if admission is None:
        raise RuntimeError("admissions insert returned no id.")
    return admission


def close_admission(admission_id: str) -> None:
    db.execute(
        "UPDATE admissions SET discharged_at = now() WHERE id = %s::uuid AND discharged_at IS NULL", [admission_id]
    )


def move_admission(admission_id: str, to_bed_id: str) -> None:
    db.execute("UPDATE admissions SET bed_id = %s::uuid WHERE id = %s::uuid", [to_bed_id, admission_id])


def occupant_of(bed_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT a.id AS admission_id, p.id AS patient_id, p.full_name, p.age_years, p.sex::text AS sex,
               a.admitted_at, a.source, a.bed_request_id
          FROM beds b
          JOIN admissions a ON a.id = b.current_admission_id
          JOIN patients p ON p.id = a.patient_id
         WHERE b.id = %s::uuid AND b.state = 'occupied'
        """,
        [bed_id],
    )
    if row is None:
        return None
    return {
        "admissionId": row["admission_id"],
        "patientId": row["patient_id"],
        "fullName": row["full_name"],
        "ageYears": row["age_years"],
        "sex": row["sex"],
        "admittedAt": from_datetime(row["admitted_at"]),
        "source": row["source"],
        "bedRequestId": row["bed_request_id"],
    }


def _to_capacity(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "hospitalId": row["hospital_id"],
        "bedTotal": row["bed_total"],
        "bedFree": row["bed_free"],
        "icuTotal": row["icu_total"],
        "icuFree": row["icu_free"],
        "icuAsOf": _iso(row["icu_as_of"]),
        "bedsAsOf": _iso(row["beds_as_of"]),
        "byKind": [
            {**entry, "asOf": None if entry.get("asOf") is None else from_epoch_ms(parse_ms(entry["asOf"]))}
            for entry in (row["by_kind"] or [])
        ],
    }


def public_capacity(hospital_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not hospital_ids:
        return {}
    rows = db.fetch_all(
        """
        SELECT hospital_id, bed_total, bed_free, icu_total, icu_free, icu_as_of, beds_as_of, by_kind
          FROM v_public_hospital_capacity
         WHERE hospital_id = ANY(%s::uuid[])
           AND fn_module_on(hospital_id, 'beds')
           AND fn_publishes(hospital_id, 'beds')
        """,
        [list(hospital_ids)],
    )
    return {r["hospital_id"]: _to_capacity(r) for r in rows}


def withholding_beds(hospital_ids: list[str]) -> set[str]:
    if not hospital_ids:
        return set()
    rows = db.fetch_all(
        """
        SELECT h.id FROM hospitals h
         WHERE h.id = ANY(%s::uuid[])
           AND fn_module_on(h.id, 'beds') AND NOT fn_publishes(h.id, 'beds')
        """,
        [list(hospital_ids)],
    )
    return {r["id"] for r in rows}


def hospitals_with_kind(kind: str) -> set[str]:
    rows = db.fetch_all(
        """
        SELECT DISTINCT hospital_id FROM beds
         WHERE kind = %s::bed_kind AND deleted_at IS NULL
           AND fn_module_on(hospital_id, 'beds')
        """,
        [kind],
    )
    return {r["hospital_id"] for r in rows}


def stale_threshold_minutes(hospital_id: str) -> int:
    value = db.fetch_value(
        "SELECT stale_threshold_minutes FROM hospital_settings WHERE hospital_id = %s::uuid", [hospital_id]
    )
    return 10 if value is None else int(value)


# --- Bed requests (FR-PAT-52, FR-BED-07) ---------------------------------------

_REQUEST_SELECT = """
  r.id, r.hospital_id, r.patient_id, r.bed_kind::text AS bed_kind, r.state, r.bed_id,
  r.hold_expires_at, r.requested_by_guest_id, r.requested_by_user_id, r.responded_at,
  r.created_at, r.expected_arrival_at
"""


def _to_request(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r["id"],
        "hospitalId": r["hospital_id"],
        "patientId": r["patient_id"],
        "bedKind": r["bed_kind"],
        "state": r["state"],
        "bedId": r["bed_id"],
        "holdExpiresAt": _iso(r["hold_expires_at"]),
        "requestedByGuestId": r["requested_by_guest_id"],
        "requestedByUserId": r["requested_by_user_id"],
        "respondedAt": _iso(r["responded_at"]),
        "createdAt": from_datetime(r["created_at"]),
        "expectedArrivalAt": _iso(r["expected_arrival_at"]),
    }


def find_request(request_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        f"SELECT {_REQUEST_SELECT} FROM bed_requests r WHERE r.id = %s::uuid AND r.deleted_at IS NULL", [request_id]
    )
    return None if row is None else _to_request(row)


def lock_request(request_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        f"SELECT {_REQUEST_SELECT} FROM bed_requests r WHERE r.id = %s::uuid AND r.deleted_at IS NULL FOR UPDATE OF r",
        [request_id],
    )
    return None if row is None else _to_request(row)


def find_existing_request(*, idempotency_key: str | None, patient_id: str, hospital_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        f"""
        SELECT {_REQUEST_SELECT} FROM bed_requests r
         WHERE r.deleted_at IS NULL
           AND (
             (%(key)s::text IS NOT NULL AND r.idempotency_key = %(key)s)
             OR (r.patient_id = %(patient)s::uuid AND r.hospital_id = %(hospital)s::uuid
                 AND r.state IN ('requested', 'held'))
           )
         ORDER BY r.created_at DESC
         LIMIT 1
        """,
        {"key": idempotency_key, "patient": patient_id, "hospital": hospital_id},
    )
    return None if row is None else _to_request(row)


def insert_request(
    *,
    hospital_id: str,
    patient_id: str,
    bed_kind: str,
    guest_id: str,
    note: str | None,
    expected_arrival_at: str | None,
    idempotency_key: str | None,
) -> dict[str, Any]:
    row = db.fetch_one(
        f"""
        INSERT INTO bed_requests AS r
          (hospital_id, patient_id, bed_kind, requested_by_guest_id, note, expected_arrival_at, idempotency_key)
        VALUES (%s::uuid, %s::uuid, %s::bed_kind, %s::uuid, %s, %s::timestamptz, %s)
        RETURNING {_REQUEST_SELECT}
        """,
        [hospital_id, patient_id, bed_kind, guest_id, note, expected_arrival_at, idempotency_key],
    )
    if row is None:
        raise RuntimeError("bed_requests insert returned no row.")
    return _to_request(row)


def answer_request(
    *, request_id: str, state: str, bed_id: str | None, hold_expires_at: datetime | None, responded_by: str | None
) -> None:
    db.execute(
        """
        UPDATE bed_requests
           SET state           = %s,
               bed_id          = %s::uuid,
               hold_expires_at = %s,
               responded_by    = coalesce(%s::uuid, responded_by),
               responded_at    = coalesce(responded_at, now())
         WHERE id = %s::uuid
        """,
        [state, bed_id, hold_expires_at, responded_by, request_id],
    )


def pending_requests(hospital_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        f"""
        SELECT {_REQUEST_SELECT},
               p.full_name, p.age_years, p.sex::text AS sex,
               COALESCE(p.phone, g.phone, u.phone) AS contact_phone,
               r.note, hb.label AS held_bed_label
          FROM bed_requests r
          JOIN patients p ON p.id = r.patient_id
          LEFT JOIN guest_identities g ON g.id = r.requested_by_guest_id
          LEFT JOIN users u ON u.id = r.requested_by_user_id
          LEFT JOIN beds hb ON hb.id = r.bed_id
         WHERE r.hospital_id = %s::uuid
           AND r.state IN ('requested', 'held')
           AND r.deleted_at IS NULL
         ORDER BY r.created_at
        """,
        [hospital_id],
    )
    return [
        {
            **_to_request(r),
            "patientName": r["full_name"],
            "patientAgeYears": r["age_years"],
            "patientSex": r["sex"],
            "contactPhone": r["contact_phone"],
            "note": r["note"],
            "heldBedLabel": r["held_bed_label"],
        }
        for r in rows
    ]


def request_status(request_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT r.id, r.state, r.bed_kind::text AS bed_kind, r.hospital_id,
               h.name_bn, h.name_en, h.phone, r.hold_expires_at, r.responded_at, r.created_at
          FROM bed_requests r
          JOIN hospitals h ON h.id = r.hospital_id
         WHERE r.id = %s::uuid AND r.deleted_at IS NULL
        """,
        [request_id],
    )
    if row is None:
        return None
    return {
        "id": row["id"],
        "state": row["state"],
        "bedKind": row["bed_kind"],
        "hospitalId": row["hospital_id"],
        "hospitalNameBn": row["name_bn"],
        "hospitalNameEn": row["name_en"],
        "hospitalPhone": row["phone"],
        "holdExpiresAt": _iso(row["hold_expires_at"]),
        "respondedAt": _iso(row["responded_at"]),
        "createdAt": from_datetime(row["created_at"]),
    }


def hospital_exists(hospital_id: str) -> bool:
    return (
        db.fetch_one("SELECT id FROM hospitals WHERE id = %s::uuid AND is_live AND deleted_at IS NULL", [hospital_id])
        is not None
    )


def hospital_names(hospital_id: str) -> dict[str, str] | None:
    row = db.fetch_one("SELECT name_bn, name_en FROM hospitals WHERE id = %s::uuid AND deleted_at IS NULL", [hospital_id])
    return None if row is None else {"nameBn": row["name_bn"], "nameEn": row["name_en"]}
