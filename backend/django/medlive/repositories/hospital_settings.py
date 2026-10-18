"""A facility's own setup (port of `repositories/hospitalSettings.repo.ts`; S-B-11, FR-SUP-01, FR-ADM-11).

Profile, rules, face (brand and logo), departments, doctors and schedules,
wards and beds, staff and roles, capabilities, reception desks. Every write
here is in the caller's transaction, and every change is audited by the
service (`record_change`).
"""

from __future__ import annotations

import json
from typing import Any

from ..core import db
from ..domain.brand import read_brand_theme
from ..domain.time import from_datetime, now_iso

BED_UNCONFIRMED_REASON = "setup:unconfirmed"


def _iso(value: Any) -> str | None:
    return None if value is None else from_datetime(value)


def _or(value: Any, default: Any) -> Any:
    return default if value is None else value


def snapshot(hospital_id: str) -> dict[str, Any] | None:
    """Everything the settings screen shows, read at once."""
    row = db.fetch_one(
        """
        SELECT h.id, h.code, h.name_bn, h.name_en, h.kind::text AS kind, h.division, h.district,
               h.registration_no,
               h.thana, h.address_bn, h.address_en, h.phone, h.emergency_phone,
               h.description_bn, h.description_en, h.portal_domain, s.modules_off, s.unpublished,
               s.brand,
               l.sha256 AS logo_sha256, l.content_type AS logo_type,
               octet_length(l.bytes) AS logo_bytes,
               h.lat::float8 AS lat, h.lng::float8 AS lng, h.is_live, h.onboarded_at,
               h.lifecycle::text AS lifecycle, h.review_requested_at, h.review_note,
               s.no_show_grace_patients, s.no_show_grace_minutes, s.late_reinsert_after,
               s.stale_threshold_minutes, s.sms_budget_monthly, s.payment_hold_minutes,
               s.prepay_required, s.noshow_prepay, s.noshow_window_days, s.arrival_windows
          FROM hospitals h
          LEFT JOIN hospital_settings s ON s.hospital_id = h.id
          LEFT JOIN hospital_logos l ON l.hospital_id = h.id
         WHERE h.id = %s AND h.deleted_at IS NULL
        """,
        [hospital_id],
    )
    if row is None:
        return None
    departments = db.fetch_all(
        """
        SELECT id, name_bn, name_en, code, sort_order FROM departments
         WHERE hospital_id = %s AND deleted_at IS NULL ORDER BY sort_order, name_en
        """,
        [hospital_id],
    )
    doctors = db.fetch_all(
        """
        SELECT dh.id AS doctor_hospital_id, d.id AS doctor_id, d.full_name_bn, d.full_name_en,
               d.bmdc_number, d.bmdc_verified_at, d.degrees, d.specialties, d.default_consult_minutes,
               dh.department_id, dh.room, dh.fee_poisha, dh.is_active
          FROM doctor_hospitals dh
          JOIN doctors d ON d.id = dh.doctor_id
         WHERE dh.hospital_id = %s AND dh.deleted_at IS NULL AND d.deleted_at IS NULL
         ORDER BY d.full_name_en
        """,
        [hospital_id],
    )
    templates = db.fetch_all(
        """
        SELECT t.id, t.doctor_hospital_id, t.weekday, to_char(t.start_time, 'HH24:MI') AS start_time,
               to_char(t.end_time, 'HH24:MI') AS end_time, t.capacity
          FROM session_templates t
          JOIN doctor_hospitals dh ON dh.id = t.doctor_hospital_id
         WHERE dh.hospital_id = %s AND t.deleted_at IS NULL
           AND (t.active_to IS NULL OR t.active_to >= (now() AT TIME ZONE 'Asia/Dhaka')::date)
         ORDER BY t.weekday, t.start_time
        """,
        [hospital_id],
    )
    wards = db.fetch_all(
        """
        SELECT id, name_bn, name_en, floor, kind::text AS kind FROM wards
         WHERE hospital_id = %s AND deleted_at IS NULL ORDER BY floor, name_en
        """,
        [hospital_id],
    )
    beds = db.fetch_all(
        """
        SELECT id, ward_id, label, kind::text AS kind, state::text AS state, nightly_poisha,
               (state = 'out_of_service' AND oos_reason = %s) AS unconfirmed
          FROM beds WHERE hospital_id = %s AND deleted_at IS NULL ORDER BY label
        """,
        [BED_UNCONFIRMED_REASON, hospital_id],
    )
    staff = db.fetch_all(
        """
        SELECT su.id, su.full_name, su.email, su.staff_code, su.is_active, su.must_change_password,
               su.totp_enabled_at IS NOT NULL AS two_factor_enabled, su.last_login_at,
               array_agg(sr.role::text ORDER BY sr.role) FILTER (WHERE sr.id IS NOT NULL) AS roles
          FROM staff_users su
          LEFT JOIN staff_roles sr
            ON sr.staff_user_id = su.id AND sr.hospital_id = su.hospital_id AND sr.deleted_at IS NULL
         WHERE su.hospital_id = %s AND su.deleted_at IS NULL
         GROUP BY su.id
         ORDER BY su.full_name
        """,
        [hospital_id],
    )
    logo = (
        None
        if row["logo_sha256"] is None or row["logo_type"] is None or row["logo_bytes"] is None
        else {"version": row["logo_sha256"][:16], "contentType": row["logo_type"], "bytes": row["logo_bytes"]}
    )
    return {
        "hospital": {
            "id": row["id"],
            "code": row["code"],
            "nameBn": row["name_bn"],
            "nameEn": row["name_en"],
            "kind": row["kind"],
            "division": row["division"],
            "district": row["district"],
            "registrationNo": row["registration_no"],
            "thana": row["thana"],
            "addressBn": row["address_bn"],
            "addressEn": row["address_en"],
            "phone": row["phone"],
            "emergencyPhone": row["emergency_phone"],
            "descriptionBn": row["description_bn"],
            "descriptionEn": row["description_en"],
            "portalDomain": row["portal_domain"],
            "modulesOff": list(row["modules_off"] or []),
            "unpublished": list(row["unpublished"] or []),
            "lat": row["lat"],
            "lng": row["lng"],
            "isLive": row["is_live"],
            "onboardedAt": _iso(row["onboarded_at"]),
            "lifecycle": row["lifecycle"],
            "reviewRequestedAt": _iso(row["review_requested_at"]),
            "reviewNote": row["review_note"],
        },
        "rules": {
            "noShowGracePatients": _or(row["no_show_grace_patients"], 2),
            "noShowGraceMinutes": _or(row["no_show_grace_minutes"], 15),
            "lateReinsertAfter": _or(row["late_reinsert_after"], 3),
            "staleThresholdMinutes": _or(row["stale_threshold_minutes"], 10),
            "smsBudgetMonthly": row["sms_budget_monthly"],
            "paymentHoldMinutes": _or(row["payment_hold_minutes"], 15),
            "prepayRequired": _or(row["prepay_required"], False),
            "noShowPrepay": _or(row["noshow_prepay"], False),
            "noShowWindowDays": _or(row["noshow_window_days"], 90),
            "arrivalWindows": _or(row["arrival_windows"], False),
        },
        "face": {"theme": read_brand_theme(row["brand"]), "logo": logo},
        "departments": [
            {"id": d["id"], "nameBn": d["name_bn"], "nameEn": d["name_en"], "code": d["code"], "sortOrder": d["sort_order"]}
            for d in departments
        ],
        "doctors": [
            {
                "doctorHospitalId": d["doctor_hospital_id"],
                "doctorId": d["doctor_id"],
                "nameBn": d["full_name_bn"],
                "nameEn": d["full_name_en"],
                "bmdcNumber": d["bmdc_number"],
                "verified": d["bmdc_verified_at"] is not None,
                "degrees": d["degrees"],
                "specialties": d["specialties"],
                "defaultConsultMinutes": d["default_consult_minutes"],
                "departmentId": d["department_id"],
                "room": d["room"],
                "feePoisha": d["fee_poisha"],
                "isActive": d["is_active"],
            }
            for d in doctors
        ],
        "templates": [
            {
                "id": t["id"],
                "doctorHospitalId": t["doctor_hospital_id"],
                "weekday": t["weekday"],
                "startTime": t["start_time"],
                "endTime": t["end_time"],
                "capacity": t["capacity"],
            }
            for t in templates
        ],
        "wards": [
            {
                "id": w["id"],
                "nameBn": w["name_bn"],
                "nameEn": w["name_en"],
                "floor": w["floor"],
                "kind": w["kind"],
                "beds": [
                    {
                        "id": b["id"],
                        "label": b["label"],
                        "kind": b["kind"],
                        "state": b["state"],
                        "nightlyPoisha": b["nightly_poisha"],
                        "unconfirmed": b["unconfirmed"],
                    }
                    for b in beds
                    if b["ward_id"] == w["id"]
                ],
            }
            for w in wards
        ],
        "staff": [
            {
                "id": s["id"],
                "fullName": s["full_name"],
                "email": s["email"],
                "staffCode": s["staff_code"],
                "isActive": s["is_active"],
                "mustChangePassword": s["must_change_password"],
                "twoFactorEnabled": s["two_factor_enabled"],
                "lastLoginAt": _iso(s["last_login_at"]),
                "roles": s["roles"] or [],
            }
            for s in staff
        ],
        "capabilities": capabilities_of(hospital_id),
        "serverTs": now_iso(),
    }


_PROFILE_COLUMNS = {
    "nameBn": "name_bn",
    "nameEn": "name_en",
    "division": "division",
    "district": "district",
    "registrationNo": "registration_no",
    "thana": "thana",
    "addressBn": "address_bn",
    "addressEn": "address_en",
    "phone": "phone",
    "emergencyPhone": "emergency_phone",
    "descriptionBn": "description_bn",
    "descriptionEn": "description_en",
}


def update_profile(hospital_id: str, fields: dict[str, Any]) -> None:
    """Writes the fields given; a field given as null is cleared, an absent one kept."""
    sets = []
    params: dict[str, Any] = {"id": hospital_id}
    for key, column in _PROFILE_COLUMNS.items():
        sets.append(f"{column} = CASE WHEN %(has_{key})s THEN %({key})s ELSE {column} END")
        params[f"has_{key}"] = key in fields
        params[key] = fields.get(key)
    for key in ("lat", "lng"):
        sets.append(f"{key} = CASE WHEN %(has_{key})s THEN %({key})s::float8 ELSE {key} END")
        params[f"has_{key}"] = key in fields
        params[key] = fields.get(key)
    db.execute(f"UPDATE hospitals SET {', '.join(sets)}, updated_at = now() WHERE id = %(id)s", params)


def _ensure_settings(hospital_id: str) -> None:
    db.execute(
        "INSERT INTO hospital_settings (hospital_id) VALUES (%s) ON CONFLICT (hospital_id) DO NOTHING", [hospital_id]
    )


def modules_off(hospital_id: str) -> list[str]:
    row = db.fetch_one("SELECT modules_off FROM hospital_settings WHERE hospital_id = %s", [hospital_id])
    if row is None or row["modules_off"] is None:
        return []
    return list(row["modules_off"])


def set_modules_off(hospital_id: str, off: list[str]) -> None:
    _ensure_settings(hospital_id)
    db.execute(
        "UPDATE hospital_settings SET modules_off = %s::text[], updated_at = now() WHERE hospital_id = %s",
        [list(off), hospital_id],
    )


def set_unpublished(hospital_id: str, unpublished: list[str]) -> None:
    _ensure_settings(hospital_id)
    db.execute(
        "UPDATE hospital_settings SET unpublished = %s::text[], updated_at = now() WHERE hospital_id = %s",
        [list(unpublished), hospital_id],
    )


def set_brand(hospital_id: str, theme: dict[str, Any] | None) -> None:
    _ensure_settings(hospital_id)
    db.execute(
        "UPDATE hospital_settings SET brand = %s::jsonb, updated_at = now() WHERE hospital_id = %s",
        [None if theme is None else json.dumps(theme, separators=(",", ":")), hospital_id],
    )


def set_logo(*, hospital_id: str, content_type: str, data: bytes, sha256: str, staff_id: str) -> None:
    db.execute(
        """
        INSERT INTO hospital_logos (hospital_id, content_type, bytes, sha256, created_by)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (hospital_id) DO UPDATE
           SET content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes,
               sha256 = EXCLUDED.sha256, created_by = EXCLUDED.created_by
        """,
        [hospital_id, content_type, data, sha256, staff_id],
    )


def remove_logo(hospital_id: str) -> bool:
    return db.execute("DELETE FROM hospital_logos WHERE hospital_id = %s", [hospital_id]) > 0


def own_logo(hospital_id: str) -> dict[str, Any] | None:
    row = db.fetch_one("SELECT content_type, bytes FROM hospital_logos WHERE hospital_id = %s", [hospital_id])
    return None if row is None else {"contentType": row["content_type"], "bytes": bytes(row["bytes"])}


_RULE_COLUMNS = (
    ("noShowGracePatients", "no_show_grace_patients", "int"),
    ("noShowGraceMinutes", "no_show_grace_minutes", "int"),
    ("lateReinsertAfter", "late_reinsert_after", "int"),
    ("staleThresholdMinutes", "stale_threshold_minutes", "int"),
    ("paymentHoldMinutes", "payment_hold_minutes", "int"),
    ("prepayRequired", "prepay_required", "boolean"),
    ("noShowPrepay", "noshow_prepay", "boolean"),
    ("noShowWindowDays", "noshow_window_days", "int"),
    ("arrivalWindows", "arrival_windows", "boolean"),
)


def update_rules(hospital_id: str, fields: dict[str, Any]) -> None:
    _ensure_settings(hospital_id)
    sets = [f"{column} = coalesce(%({key})s::{kind}, {column})" for key, column, kind in _RULE_COLUMNS]
    params: dict[str, Any] = {key: fields.get(key) for key, _, _ in _RULE_COLUMNS}
    sets.append("sms_budget_monthly = CASE WHEN %(has_sms)s THEN %(sms)s::int ELSE sms_budget_monthly END")
    params["has_sms"] = "smsBudgetMonthly" in fields
    params["sms"] = fields.get("smsBudgetMonthly")
    params["id"] = hospital_id
    db.execute(f"UPDATE hospital_settings SET {', '.join(sets)}, updated_at = now() WHERE hospital_id = %(id)s", params)


def _one(sql: str, params: list[Any]) -> bool:
    return db.fetch_one(sql, params) is not None


def department_code_taken(hospital_id: str, code: str) -> bool:
    return _one(
        "SELECT 1 AS one FROM departments WHERE hospital_id = %s AND code = %s AND deleted_at IS NULL", [hospital_id, code]
    )


def create_department(*, hospital_id: str, name_bn: str, name_en: str, code: str, sort_order: int, created_by: str) -> str:
    department_id = db.fetch_value(
        """
        INSERT INTO departments (hospital_id, name_bn, name_en, code, sort_order, created_by)
        VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
        """,
        [hospital_id, name_bn, name_en, code, sort_order, created_by],
    )
    if department_id is None:
        raise RuntimeError("departments returned no id")
    return department_id


def update_department(hospital_id: str, department_id: str, fields: dict[str, Any]) -> bool:
    return (
        db.execute(
            """
            UPDATE departments SET
              name_bn = coalesce(%s, name_bn),
              name_en = coalesce(%s, name_en),
              sort_order = coalesce(%s::int, sort_order),
              updated_at = now()
            WHERE id = %s AND hospital_id = %s AND deleted_at IS NULL
            """,
            [fields.get("nameBn"), fields.get("nameEn"), fields.get("sortOrder"), department_id, hospital_id],
        )
        == 1
    )


def remove_department(hospital_id: str, department_id: str) -> dict[str, bool]:
    rows = db.fetch_all(
        """
        UPDATE departments dep SET deleted_at = now(), updated_at = now()
         WHERE dep.id = %s AND dep.hospital_id = %s AND dep.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM doctor_hospitals dh WHERE dh.department_id = dep.id AND dh.deleted_at IS NULL)
        RETURNING dep.id
        """,
        [department_id, hospital_id],
    )
    if len(rows) == 1:
        return {"removed": True, "inUse": False}
    return {
        "removed": False,
        "inUse": _one(
            "SELECT 1 AS one FROM departments WHERE id = %s AND hospital_id = %s AND deleted_at IS NULL",
            [department_id, hospital_id],
        ),
    }


def department_belongs(hospital_id: str, department_id: str) -> bool:
    return _one(
        "SELECT 1 AS one FROM departments WHERE id = %s AND hospital_id = %s AND deleted_at IS NULL",
        [department_id, hospital_id],
    )


def doctor_by_bmdc(bmdc_number: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        "SELECT id, bmdc_verified_at FROM doctors WHERE upper(bmdc_number) = upper(%s) AND deleted_at IS NULL",
        [bmdc_number],
    )
    return None if row is None else {"id": row["id"], "verified": row["bmdc_verified_at"] is not None}


def create_doctor(
    *,
    name_bn: str,
    name_en: str,
    bmdc_number: str,
    degrees: str | None,
    specialties: list[str],
    default_consult_minutes: int,
    created_by: str,
) -> str:
    doctor_id = db.fetch_value(
        """
        INSERT INTO doctors (full_name_bn, full_name_en, bmdc_number, degrees, specialties,
                             default_consult_minutes, created_by)
        VALUES (%s, %s, %s, %s, %s::text[], %s, %s) RETURNING id
        """,
        [name_bn, name_en, bmdc_number.upper(), degrees, list(specialties), default_consult_minutes, created_by],
    )
    if doctor_id is None:
        raise RuntimeError("doctors returned no id")
    return doctor_id


def doctor_already_here(hospital_id: str, doctor_id: str, department_id: str) -> bool:
    return _one(
        """
        SELECT 1 AS one FROM doctor_hospitals
         WHERE hospital_id = %s AND doctor_id = %s AND department_id = %s AND deleted_at IS NULL
        """,
        [hospital_id, doctor_id, department_id],
    )


def link_doctor(
    *, doctor_id: str, hospital_id: str, department_id: str, fee_poisha: int, room: str | None, created_by: str
) -> str:
    link_id = db.fetch_value(
        """
        INSERT INTO doctor_hospitals (doctor_id, hospital_id, department_id, fee_poisha, room, created_by)
        VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
        """,
        [doctor_id, hospital_id, department_id, fee_poisha, room, created_by],
    )
    if link_id is None:
        raise RuntimeError("doctor_hospitals returned no id")
    return link_id


def chamber_of_doctor(hospital_id: str, doctor_hospital_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT dh.id, dh.doctor_id, dh.department_id, d.bmdc_verified_at
          FROM doctor_hospitals dh
          JOIN doctors d ON d.id = dh.doctor_id
         WHERE dh.id = %s AND dh.hospital_id = %s AND dh.deleted_at IS NULL
        """,
        [doctor_hospital_id, hospital_id],
    )
    if row is None:
        return None
    return {
        "doctorHospitalId": row["id"],
        "doctorId": row["doctor_id"],
        "departmentId": row["department_id"],
        "verified": row["bmdc_verified_at"] is not None,
    }


def update_doctor_hospital(doctor_hospital_id: str, fields: dict[str, Any]) -> None:
    db.execute(
        """
        UPDATE doctor_hospitals SET
          fee_poisha = coalesce(%s::int, fee_poisha),
          room = CASE WHEN %s THEN %s ELSE room END,
          is_active = coalesce(%s::boolean, is_active),
          updated_at = now()
        WHERE id = %s
        """,
        [fields.get("feePoisha"), "room" in fields, fields.get("room"), fields.get("isActive"), doctor_hospital_id],
    )


def update_doctor_identity(doctor_id: str, fields: dict[str, Any]) -> None:
    db.execute(
        """
        UPDATE doctors SET
          full_name_bn = coalesce(%s, full_name_bn),
          full_name_en = coalesce(%s, full_name_en),
          degrees = CASE WHEN %s THEN %s ELSE degrees END,
          default_consult_minutes = coalesce(%s::int, default_consult_minutes),
          updated_at = now()
        WHERE id = %s
        """,
        [
            fields.get("nameBn"),
            fields.get("nameEn"),
            "degrees" in fields,
            fields.get("degrees"),
            fields.get("defaultConsultMinutes"),
            doctor_id,
        ],
    )


def carry_to_scheduled_sessions(*, hospital_id: str, doctor_id: str, department_id: str, fields: dict[str, Any]) -> None:
    db.execute(
        """
        UPDATE sessions SET
          fee_poisha = coalesce(%s::int, fee_poisha),
          room = CASE WHEN %s THEN %s ELSE room END,
          updated_at = now()
        WHERE hospital_id = %s AND doctor_id = %s AND department_id = %s AND status = 'scheduled' AND deleted_at IS NULL
          AND session_date >= (now() AT TIME ZONE 'Asia/Dhaka')::date
        """,
        [fields.get("feePoisha"), "room" in fields, fields.get("room"), hospital_id, doctor_id, department_id],
    )


def create_template(
    *, doctor_hospital_id: str, weekday: int, start_time: str, end_time: str, capacity: int | None, created_by: str
) -> str:
    template_id = db.fetch_value(
        """
        INSERT INTO session_templates (doctor_hospital_id, weekday, start_time, end_time, capacity,
                                       active_from, created_by)
        VALUES (%s, %s, %s::time, %s::time, %s, (now() AT TIME ZONE 'Asia/Dhaka')::date, %s)
        RETURNING id
        """,
        [doctor_hospital_id, weekday, start_time, end_time, capacity, created_by],
    )
    if template_id is None:
        raise RuntimeError("session_templates returned no id")
    return template_id


def template_overlaps(*, doctor_id: str, weekday: int, start_time: str, end_time: str) -> bool:
    return _one(
        """
        SELECT 1 AS one
          FROM session_templates t
          JOIN doctor_hospitals dh ON dh.id = t.doctor_hospital_id
         WHERE dh.doctor_id = %s AND t.weekday = %s AND t.deleted_at IS NULL
           AND (t.active_to IS NULL OR t.active_to >= (now() AT TIME ZONE 'Asia/Dhaka')::date)
           AND t.start_time < %s::time AND t.end_time > %s::time
        """,
        [doctor_id, weekday, end_time, start_time],
    )


def template_of(hospital_id: str, template_id: str) -> dict[str, str] | None:
    row = db.fetch_one(
        """
        SELECT t.id FROM session_templates t
          JOIN doctor_hospitals dh ON dh.id = t.doctor_hospital_id
         WHERE t.id = %s AND dh.hospital_id = %s AND t.deleted_at IS NULL
        """,
        [template_id, hospital_id],
    )
    return None if row is None else {"id": row["id"]}


def end_template(template_id: str) -> int:
    """Ends a schedule; its future empty chambers go, booked ones stay (and are counted)."""
    db.execute("UPDATE session_templates SET deleted_at = now(), updated_at = now() WHERE id = %s", [template_id])
    db.execute(
        """
        UPDATE sessions s SET deleted_at = now(), updated_at = now()
         WHERE s.template_id = %s AND s.status = 'scheduled' AND s.deleted_at IS NULL
           AND s.session_date >= (now() AT TIME ZONE 'Asia/Dhaka')::date
           AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.session_id = s.id AND b.deleted_at IS NULL)
        """,
        [template_id],
    )
    kept = db.fetch_value(
        """
        SELECT count(*)::text AS n FROM sessions
         WHERE template_id = %s AND deleted_at IS NULL AND status = 'scheduled'
           AND session_date >= (now() AT TIME ZONE 'Asia/Dhaka')::date
        """,
        [template_id],
    )
    return int(kept or "0")


def create_ward(*, hospital_id: str, name_bn: str, name_en: str, floor: int, kind: str, created_by: str) -> str:
    ward_id = db.fetch_value(
        """
        INSERT INTO wards (hospital_id, name_bn, name_en, floor, kind, created_by)
        VALUES (%s, %s, %s, %s, %s::bed_kind, %s) RETURNING id
        """,
        [hospital_id, name_bn, name_en, floor, kind, created_by],
    )
    if ward_id is None:
        raise RuntimeError("wards returned no id")
    return ward_id


def ward_of(hospital_id: str, ward_id: str) -> dict[str, str] | None:
    row = db.fetch_one(
        "SELECT kind::text AS kind FROM wards WHERE id = %s AND hospital_id = %s AND deleted_at IS NULL",
        [ward_id, hospital_id],
    )
    return None if row is None else {"kind": row["kind"]}


def ward_name_taken(hospital_id: str, name_en: str, except_ward_id: str) -> bool:
    return _one(
        "SELECT 1 AS one FROM wards WHERE hospital_id = %s AND name_en = %s AND deleted_at IS NULL AND id <> %s",
        [hospital_id, name_en, except_ward_id],
    )


def update_ward(hospital_id: str, ward_id: str, fields: dict[str, Any]) -> bool:
    return (
        db.execute(
            """
            UPDATE wards SET
              name_bn = coalesce(%s, name_bn), name_en = coalesce(%s, name_en),
              floor = coalesce(%s::int, floor), updated_at = now()
            WHERE id = %s AND hospital_id = %s AND deleted_at IS NULL
            """,
            [fields.get("nameBn"), fields.get("nameEn"), fields.get("floor"), ward_id, hospital_id],
        )
        == 1
    )


def remove_ward(hospital_id: str, ward_id: str) -> dict[str, bool]:
    rows = db.fetch_all(
        """
        UPDATE wards w SET deleted_at = now(), updated_at = now()
         WHERE w.id = %s AND w.hospital_id = %s AND w.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM beds b WHERE b.ward_id = w.id AND b.deleted_at IS NULL)
        RETURNING w.id
        """,
        [ward_id, hospital_id],
    )
    if len(rows) == 1:
        return {"removed": True, "inUse": False}
    return {
        "removed": False,
        "inUse": _one(
            "SELECT 1 AS one FROM wards WHERE id = %s AND hospital_id = %s AND deleted_at IS NULL", [ward_id, hospital_id]
        ),
    }


def remove_unconfirmed_bed(hospital_id: str, bed_id: str) -> dict[str, bool]:
    rows = db.fetch_all(
        """
        UPDATE beds b SET deleted_at = now(), updated_at = now()
         WHERE b.id = %s AND b.hospital_id = %s AND b.deleted_at IS NULL
           AND b.state = 'out_of_service' AND b.oos_reason = %s
           AND NOT EXISTS (SELECT 1 FROM admissions a WHERE a.bed_id = b.id)
           AND NOT EXISTS (SELECT 1 FROM bed_events e WHERE e.bed_id = b.id)
        RETURNING b.id
        """,
        [bed_id, hospital_id, BED_UNCONFIRMED_REASON],
    )
    if len(rows) == 1:
        return {"removed": True, "inUse": False}
    return {
        "removed": False,
        "inUse": _one(
            "SELECT 1 AS one FROM beds WHERE id = %s AND hospital_id = %s AND deleted_at IS NULL", [bed_id, hospital_id]
        ),
    }


def bed_label_taken(hospital_id: str, label: str, except_bed_id: str | None) -> bool:
    return _one(
        """
        SELECT 1 AS one FROM beds
         WHERE hospital_id = %(h)s AND lower(label) = lower(%(label)s) AND deleted_at IS NULL
           AND (%(except)s::uuid IS NULL OR id <> %(except)s::uuid)
        """,
        {"h": hospital_id, "label": label, "except": except_bed_id},  # type: ignore[arg-type]
    )


def create_bed(
    *, hospital_id: str, ward_id: str, label: str, kind: str, nightly_poisha: int, unconfirmed_reason: str, created_by: str
) -> str:
    bed_id = db.fetch_value(
        """
        INSERT INTO beds (hospital_id, ward_id, label, kind, state, nightly_poisha, oos_reason, created_by)
        VALUES (%s, %s, %s, %s::bed_kind, 'out_of_service', %s, %s, %s) RETURNING id
        """,
        [hospital_id, ward_id, label, kind, nightly_poisha, unconfirmed_reason, created_by],
    )
    if bed_id is None:
        raise RuntimeError("beds returned no id")
    return bed_id


def update_bed(hospital_id: str, bed_id: str, fields: dict[str, Any]) -> bool:
    return (
        db.execute(
            """
            UPDATE beds SET label = coalesce(%s, label), nightly_poisha = coalesce(%s::int, nightly_poisha),
                   updated_at = now()
             WHERE id = %s AND hospital_id = %s AND deleted_at IS NULL
            """,
            [fields.get("label"), fields.get("nightlyPoisha"), bed_id, hospital_id],
        )
        == 1
    )


def staff_of(hospital_id: str, staff_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        "SELECT id, is_active FROM staff_users WHERE id = %s AND hospital_id = %s AND deleted_at IS NULL",
        [staff_id, hospital_id],
    )
    return None if row is None else {"id": row["id"], "isActive": row["is_active"]}


def update_staff(staff_id: str, fields: dict[str, Any]) -> None:
    db.execute(
        """
        UPDATE staff_users SET
          full_name = coalesce(%s, full_name),
          is_active = coalesce(%s::boolean, is_active),
          staff_code = CASE WHEN %s THEN %s ELSE staff_code END,
          updated_at = now()
        WHERE id = %s
        """,
        [fields.get("fullName"), fields.get("isActive"), "staffCode" in fields, fields.get("staffCode"), staff_id],
    )


def set_roles(*, staff_id: str, hospital_id: str, roles: list[str], by: str) -> None:
    db.execute(
        """
        UPDATE staff_roles SET deleted_at = now(), updated_at = now()
         WHERE staff_user_id = %s AND hospital_id = %s AND deleted_at IS NULL
           AND NOT (role::text = ANY(%s::text[]))
        """,
        [staff_id, hospital_id, list(roles)],
    )
    for role in roles:
        db.execute(
            """
            INSERT INTO staff_roles (staff_user_id, hospital_id, role, created_by)
            VALUES (%s, %s, %s::staff_role, %s) ON CONFLICT DO NOTHING
            """,
            [staff_id, hospital_id, role, by],
        )


def active_administrators(hospital_id: str) -> list[str]:
    rows = db.fetch_all(
        """
        SELECT DISTINCT su.id FROM staff_users su
          JOIN staff_roles sr ON sr.staff_user_id = su.id AND sr.deleted_at IS NULL AND sr.role = 'hospital_admin'
         WHERE su.hospital_id = %s AND su.is_active AND su.deleted_at IS NULL
        """,
        [hospital_id],
    )
    return [r["id"] for r in rows]


def record_change(
    *,
    actor_staff_id: str,
    hospital_id: str,
    subject_table: str,
    subject_id: str | None,
    change: str,
    ip: str | None,
    user_agent: str | None,
) -> None:
    db.execute(
        """
        INSERT INTO audit_log (actor_staff_id, hospital_id, action, subject_table, subject_id, ip, user_agent, meta)
        VALUES (%s, %s, 'SETTINGS_CHANGE', %s, %s, %s::inet, %s, %s::jsonb)
        """,
        [
            actor_staff_id,
            hospital_id,
            subject_table,
            subject_id,
            ip,
            user_agent,
            json.dumps({"change": change}, ensure_ascii=False, separators=(",", ":")),
        ],
    )


def staff_code_taken(hospital_id: str, staff_code: str, except_staff_id: str | None) -> bool:
    return (
        db.fetch_one(
            """
            SELECT 1 AS one FROM staff_users
             WHERE hospital_id = %(h)s AND staff_code = %(code)s AND deleted_at IS NULL
               AND (%(except)s::uuid IS NULL OR id <> %(except)s::uuid)
            """,
            {"h": hospital_id, "code": staff_code, "except": except_staff_id},
        )
        is not None
    )


def doctor_sits_elsewhere(doctor_id: str, hospital_id: str) -> bool:
    return _one(
        "SELECT 1 AS one FROM doctor_hospitals WHERE doctor_id = %s AND hospital_id <> %s AND deleted_at IS NULL",
        [doctor_id, hospital_id],
    )


def mark_doctor_verified(bmdc_number: str) -> str | None:
    return db.fetch_value(
        """
        UPDATE doctors SET bmdc_verified_at = coalesce(bmdc_verified_at, now()), updated_at = now()
         WHERE upper(bmdc_number) = upper(%s) AND deleted_at IS NULL
        RETURNING full_name_en
        """,
        [bmdc_number],
    )


def capabilities_of(hospital_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        "SELECT kind::text AS kind, is_available, updated_at FROM capabilities WHERE hospital_id = %s ORDER BY kind",
        [hospital_id],
    )
    return [{"kind": r["kind"], "isAvailable": r["is_available"], "updatedAt": from_datetime(r["updated_at"])} for r in rows]


def declare_capabilities(*, hospital_id: str, kinds: list[str], by: str) -> None:
    db.execute(
        "DELETE FROM capabilities WHERE hospital_id = %s AND NOT (kind::text = ANY(%s::text[]))",
        [hospital_id, list(kinds)],
    )
    for kind in kinds:
        db.execute(
            """
            INSERT INTO capabilities (hospital_id, kind, is_available, updated_by)
            VALUES (%s, %s::capability_kind, false, %s)
            ON CONFLICT (hospital_id, kind) DO NOTHING
            """,
            [hospital_id, kind, by],
        )


_DESK_SELECT = """
    SELECT d.id, d.name_bn, d.name_en,
           coalesce((SELECT array_agg(dd.doctor_id::text ORDER BY dd.doctor_id)
                       FROM reception_desk_doctors dd WHERE dd.desk_id = d.id), '{}') AS doctor_ids,
           coalesce((SELECT array_agg(ds.staff_user_id::text ORDER BY ds.staff_user_id)
                       FROM reception_desk_staff ds WHERE ds.desk_id = d.id), '{}') AS staff_ids
      FROM reception_desks d
"""


def _to_desk(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r["id"],
        "nameBn": r["name_bn"],
        "nameEn": r["name_en"],
        "doctorIds": list(r["doctor_ids"] or []),
        "staffIds": list(r["staff_ids"] or []),
    }


def list_desks(hospital_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        _DESK_SELECT + " WHERE d.hospital_id = %s::uuid AND d.deleted_at IS NULL ORDER BY d.name_en", [hospital_id]
    )
    return [_to_desk(r) for r in rows]


def desk_for_update(hospital_id: str, desk_id: str) -> dict[str, Any] | None:
    locked = db.fetch_one(
        """
        SELECT id FROM reception_desks
         WHERE id = %s::uuid AND hospital_id = %s::uuid AND deleted_at IS NULL
         FOR UPDATE
        """,
        [desk_id, hospital_id],
    )
    if locked is None:
        return None
    row = db.fetch_one(
        _DESK_SELECT + " WHERE d.id = %s::uuid AND d.hospital_id = %s::uuid AND d.deleted_at IS NULL",
        [desk_id, hospital_id],
    )
    return None if row is None else _to_desk(row)


def desk_name_taken(hospital_id: str, name_en: str, except_id: str | None) -> bool:
    return bool(
        db.fetch_value(
            """
            SELECT EXISTS (
              SELECT 1 FROM reception_desks
               WHERE hospital_id = %(h)s::uuid AND deleted_at IS NULL
                 AND lower(name_en) = lower(%(name)s)
                 AND (%(except)s::uuid IS NULL OR id <> %(except)s::uuid)
            ) AS taken
            """,
            {"h": hospital_id, "name": name_en, "except": except_id},
        )
    )


def doctors_not_here(hospital_id: str, doctor_ids: list[str]) -> list[str]:
    if not doctor_ids:
        return []
    rows = db.fetch_all(
        """
        SELECT wanted.id
          FROM unnest(%s::uuid[]) AS wanted(id)
         WHERE NOT EXISTS (
           SELECT 1 FROM doctor_hospitals dh WHERE dh.doctor_id = wanted.id AND dh.hospital_id = %s::uuid
         )
        """,
        [list(doctor_ids), hospital_id],
    )
    return [r["id"] for r in rows]


def create_desk(*, hospital_id: str, name_bn: str, name_en: str, created_by: str) -> str:
    desk_id = db.fetch_value(
        """
        INSERT INTO reception_desks (hospital_id, name_bn, name_en, created_by)
        VALUES (%s::uuid, %s, %s, %s::uuid) RETURNING id
        """,
        [hospital_id, name_bn, name_en, created_by],
    )
    if desk_id is None:
        raise RuntimeError("desk insert returned no id.")
    return desk_id


def rename_desk(hospital_id: str, desk_id: str, names: dict[str, Any]) -> bool:
    return (
        db.execute(
            """
            UPDATE reception_desks SET name_bn = coalesce(%s, name_bn), name_en = coalesce(%s, name_en)
             WHERE id = %s::uuid AND hospital_id = %s::uuid AND deleted_at IS NULL
            """,
            [names.get("nameBn"), names.get("nameEn"), desk_id, hospital_id],
        )
        > 0
    )


def set_desk_doctors(hospital_id: str, desk_id: str, doctor_ids: list[str]) -> None:
    db.execute("DELETE FROM reception_desk_doctors WHERE desk_id = %s::uuid", [desk_id])
    if not doctor_ids:
        return
    db.execute(
        """
        INSERT INTO reception_desk_doctors (desk_id, doctor_id, hospital_id)
        SELECT %s::uuid, doctor, %s::uuid FROM unnest(%s::uuid[]) AS doctor
        ON CONFLICT DO NOTHING
        """,
        [desk_id, hospital_id, list(doctor_ids)],
    )


def remove_desk(hospital_id: str, desk_id: str) -> bool:
    touched = db.execute(
        "UPDATE reception_desks SET deleted_at = now() WHERE id = %s::uuid AND hospital_id = %s::uuid AND deleted_at IS NULL",
        [desk_id, hospital_id],
    )
    if touched == 0:
        return False
    db.execute("DELETE FROM reception_desk_doctors WHERE desk_id = %s::uuid", [desk_id])
    db.execute("DELETE FROM reception_desk_staff WHERE desk_id = %s::uuid", [desk_id])
    return True


def desk_doctors_for_staff(staff_user_id: str, hospital_id: str) -> set[str] | None:
    """The doctors a receptionist's desks cover, or None when not at a desk (FR-REC-32)."""
    row = db.fetch_one(
        """
        SELECT EXISTS (
                 SELECT 1 FROM reception_desk_staff ds
                   JOIN reception_desks d ON d.id = ds.desk_id AND d.deleted_at IS NULL
                  WHERE ds.staff_user_id = %(s)s::uuid AND ds.hospital_id = %(h)s::uuid
               ) AS assigned,
               coalesce((
                 SELECT array_agg(DISTINCT dd.doctor_id::text)
                   FROM reception_desk_staff ds
                   JOIN reception_desks d ON d.id = ds.desk_id AND d.deleted_at IS NULL
                   JOIN reception_desk_doctors dd ON dd.desk_id = d.id
                  WHERE ds.staff_user_id = %(s)s::uuid AND ds.hospital_id = %(h)s::uuid
               ), '{}') AS doctor_ids
        """,
        {"s": staff_user_id, "h": hospital_id},
    )
    if row is None or not row["assigned"]:
        return None
    return set(row["doctor_ids"] or [])


def set_desk_staff(hospital_id: str, desk_id: str, staff_user_ids: list[str]) -> None:
    db.execute("DELETE FROM reception_desk_staff WHERE desk_id = %s::uuid", [desk_id])
    if not staff_user_ids:
        return
    db.execute(
        """
        INSERT INTO reception_desk_staff (desk_id, staff_user_id, hospital_id)
        SELECT %s::uuid, staff, %s::uuid FROM unnest(%s::uuid[]) AS staff
        ON CONFLICT DO NOTHING
        """,
        [desk_id, hospital_id, list(staff_user_ids)],
    )


def staff_not_receptionists(hospital_id: str, staff_user_ids: list[str]) -> list[str]:
    if not staff_user_ids:
        return []
    rows = db.fetch_all(
        """
        SELECT wanted.id
          FROM unnest(%s::uuid[]) AS wanted(id)
         WHERE NOT EXISTS (
           SELECT 1 FROM staff_roles sr
            WHERE sr.staff_user_id = wanted.id AND sr.hospital_id = %s::uuid
              AND sr.role = 'receptionist' AND sr.deleted_at IS NULL
         )
        """,
        [list(staff_user_ids), hospital_id],
    )
    return [r["id"] for r in rows]
