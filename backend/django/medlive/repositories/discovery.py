"""Public reads: hospitals, doctors, sessions, search (port of `repositories/discovery.repo.ts`).

Live hospitals only. A figure a hospital withholds is NULL here, never zero:
"not shared" is not a count of none (FR-NET-04).
"""

from __future__ import annotations

import math
from typing import Any

from ..core import db
from ..domain.brand import not_shared_of
from ..domain.time import from_datetime


def _iso(value: Any) -> str | None:
    return None if value is None else from_datetime(value)


def publishes(hospital_id: str, figure: str) -> bool:
    value = db.fetch_value("SELECT fn_publishes(%s::uuid, %s) AS shared", [hospital_id, figure])
    return True if value is None else bool(value)


def list_hospitals(
    *,
    limit: int,
    district: str | None = None,
    q: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    specialty: str | None = None,
    capability: str | None = None,
    hospital_id: str | None = None,
) -> list[dict[str, Any]]:
    has_position = lat is not None and lng is not None
    rows = db.fetch_all(
        """
        SELECT cards.* FROM (
        SELECT h.id, h.name_bn, h.name_en, h.kind::text AS kind, h.division, h.district,
               h.thana, h.address_bn, h.address_en, h.lat, h.lng, h.phone, h.emergency_phone,
               h.description_bn, h.description_en,
               (SELECT left(l.sha256, 16) FROM hospital_logos l WHERE l.hospital_id = h.id)
                 AS logo_version,
               CASE
                 WHEN %(has_position)s::boolean AND h.geo IS NOT NULL
                 THEN ST_Distance(h.geo, ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography)
                 ELSE NULL
               END AS distance_m,
               (SELECT array_agg(c.kind::text ORDER BY c.kind)
                  FROM capabilities c
                 WHERE c.hospital_id = h.id AND c.is_available
                   AND fn_module_on(h.id, 'emergency')) AS capabilities,
               (SELECT max(c.updated_at) FROM capabilities c
                 WHERE c.hospital_id = h.id AND fn_module_on(h.id, 'emergency'))
                 AS capability_as_of,
               CASE WHEN %(specialty)s::text IS NULL THEN NULL ELSE (
                 SELECT count(DISTINCT dh.doctor_id)::text
                   FROM doctor_hospitals dh
                   JOIN departments dep ON dep.id = dh.department_id
                  WHERE dh.hospital_id = h.id AND dh.is_active AND dh.deleted_at IS NULL
                    AND dep.code = %(specialty)s
               ) END AS doctor_count,
               CASE WHEN fn_publishes(h.id, 'serials') THEN
               (SELECT count(*)::text FROM sessions s
                 WHERE s.hospital_id = h.id AND s.status = 'running'
                   AND s.session_date = (now() AT TIME ZONE 'Asia/Dhaka')::date
                   AND s.deleted_at IS NULL
                   AND fn_module_on(h.id, 'queue')) END AS sitting_now,
               CASE WHEN fn_publishes(h.id, 'serials') THEN
               (SELECT coalesce(sum(GREATEST(coalesce(s.capacity, 0) - (SELECT c.taken FROM fn_chamber_counts(s.id) c), 0)), 0)::text
                  FROM sessions s
                 WHERE s.hospital_id = h.id
                   AND s.session_date = (now() AT TIME ZONE 'Asia/Dhaka')::date
                   AND s.status IN ('scheduled', 'running')
                   AND s.deleted_at IS NULL
                   AND fn_module_on(h.id, 'queue')) END AS open_serials_today,
               coalesce((SELECT hs.unpublished FROM hospital_settings hs
                          WHERE hs.hospital_id = h.id), '{}'::text[]) AS unpublished,
               coalesce((SELECT hs.modules_off FROM hospital_settings hs
                          WHERE hs.hospital_id = h.id), '{}'::text[]) AS modules_off
          FROM hospitals h
         WHERE h.deleted_at IS NULL
           AND h.is_live
           AND (%(hospital_id)s::uuid IS NULL OR h.id = %(hospital_id)s::uuid)
           AND (%(district)s::text IS NULL OR h.district = %(district)s)
           AND (%(specialty)s::text IS NULL
                OR EXISTS (SELECT 1
                             FROM doctor_hospitals dh
                             JOIN departments dep ON dep.id = dh.department_id
                            WHERE dh.hospital_id = h.id AND dh.is_active
                              AND dh.deleted_at IS NULL
                              AND dep.code = %(specialty)s))
           AND (%(capability)s::text IS NULL
                OR EXISTS (SELECT 1 FROM capabilities c
                            WHERE c.hospital_id = h.id AND c.is_available
                              AND fn_module_on(h.id, 'emergency')
                              AND c.kind::text = %(capability)s))
           AND (
             %(q)s::text IS NULL
             OR h.name_en ILIKE '%%' || %(q)s || '%%'
             OR h.name_bn LIKE '%%' || %(q)s || '%%'
           )
        ) cards
         ORDER BY
           cards.distance_m NULLS LAST,
           coalesce(cards.sitting_now, '0')::int DESC,
           cards.name_en
         LIMIT %(limit)s
        """,
        {
            "has_position": has_position,
            "lng": lng if lng is not None else 0,
            "lat": lat if lat is not None else 0,
            "specialty": specialty,
            "hospital_id": hospital_id,
            "district": district,
            "capability": capability,
            "q": q,
            "limit": limit,
        },
    )
    return [
        {
            "id": r["id"],
            "nameBn": r["name_bn"],
            "nameEn": r["name_en"],
            "kind": r["kind"],
            "division": r["division"],
            "district": r["district"],
            "thana": r["thana"],
            "addressBn": r["address_bn"],
            "addressEn": r["address_en"],
            "lat": r["lat"],
            "lng": r["lng"],
            "phone": r["phone"],
            "emergencyPhone": r["emergency_phone"],
            "descriptionBn": r["description_bn"],
            "descriptionEn": r["description_en"],
            "logoVersion": r["logo_version"],
            "distanceKm": None if r["distance_m"] is None else math.floor(r["distance_m"] / 100 + 0.5) / 10,
            "capabilities": r["capabilities"] or [],
            "capabilityAsOf": _iso(r["capability_as_of"]),
            "doctorCount": None if r["doctor_count"] is None else int(r["doctor_count"]),
            "sittingNow": None if r["sitting_now"] is None else int(r["sitting_now"]),
            "openSerialsToday": None if r["open_serials_today"] is None else int(r["open_serials_today"]),
            "notShared": not_shared_of(list(r["unpublished"]), list(r["modules_off"])),
        }
        for r in rows
    ]


def doctors_at_hospital(hospital_id: str, specialty: str | None = None) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT d.id, d.full_name_bn AS name_bn, d.full_name_en AS name_en, d.degrees,
               dep.code AS department_code,
               dep.name_bn AS department_name_bn, dep.name_en AS department_name_en,
               dh.fee_poisha, dh.room, d.bmdc_verified_at,
               CASE WHEN fn_publishes(%(h)s::uuid, 'serials') THEN
               EXISTS (SELECT 1 FROM sessions s
                        WHERE s.doctor_id = d.id AND s.hospital_id = %(h)s::uuid
                          AND s.status = 'running' AND s.deleted_at IS NULL
                          AND fn_module_on(%(h)s::uuid, 'queue')) END AS sitting_now,
               (SELECT min(s.planned_start) FROM sessions s
                 WHERE s.doctor_id = d.id AND s.hospital_id = %(h)s::uuid
                   AND s.status IN ('scheduled', 'running')
                   AND s.planned_end > now() AND s.deleted_at IS NULL
                   AND fn_module_on(%(h)s::uuid, 'queue')) AS next_session_at,
               fn_publishes(%(h)s::uuid, 'serials') AS serials_shared,
               CASE WHEN fn_publishes(%(h)s::uuid, 'serials') THEN
               (SELECT GREATEST(coalesce(s.capacity, 0) - (SELECT c.taken FROM fn_chamber_counts(s.id) c), 0)::text
                  FROM sessions s
                 WHERE s.doctor_id = d.id AND s.hospital_id = %(h)s::uuid
                   AND s.status IN ('scheduled', 'running')
                   AND s.planned_end > now() AND s.deleted_at IS NULL
                   AND fn_module_on(%(h)s::uuid, 'queue')
                 ORDER BY s.planned_start LIMIT 1) END AS open_serials
          FROM doctor_hospitals dh
          JOIN doctors d       ON d.id = dh.doctor_id
          JOIN departments dep ON dep.id = dh.department_id
         WHERE dh.hospital_id = %(h)s::uuid
           AND dh.is_active AND dh.deleted_at IS NULL
           AND d.deleted_at IS NULL
           AND (%(specialty)s::text IS NULL OR dep.code = %(specialty)s)
         ORDER BY sitting_now DESC NULLS LAST, next_session_at NULLS LAST, d.full_name_en
        """,
        {"h": hospital_id, "specialty": specialty},
    )
    return [
        {
            "id": r["id"],
            "nameBn": r["name_bn"],
            "nameEn": r["name_en"],
            "degrees": r["degrees"],
            "departmentCode": r["department_code"],
            "departmentNameBn": r["department_name_bn"],
            "departmentNameEn": r["department_name_en"],
            "feePoisha": r["fee_poisha"],
            "room": r["room"],
            "bmdcVerifiedAt": _iso(r["bmdc_verified_at"]),
            "sittingNow": r["sitting_now"],
            "nextSessionAt": _iso(r["next_session_at"]),
            "openSerials": None if r["open_serials"] is None else int(r["open_serials"]),
            "serialsShared": r["serials_shared"],
        }
        for r in rows
    ]


def list_departments(hospital_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT id, code, name_bn, name_en FROM departments
         WHERE hospital_id = %s AND deleted_at IS NULL
         ORDER BY sort_order, name_en
        """,
        [hospital_id],
    )
    return [{"id": r["id"], "code": r["code"], "nameBn": r["name_bn"], "nameEn": r["name_en"]} for r in rows]


def list_doctors(
    *, limit: int, specialty: str | None = None, hospital_id: str | None = None, q: str | None = None
) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT d.id, d.full_name_bn, d.full_name_en, d.degrees, d.specialties,
               d.bmdc_verified_at, d.default_consult_minutes,
               COALESCE(
                 (SELECT jsonb_agg(jsonb_build_object(
                           'hospitalId', h.id,
                           'hospitalNameBn', h.name_bn,
                           'hospitalNameEn', h.name_en,
                           'departmentCode', dep.code,
                           'feePoisha', dh.fee_poisha,
                           'room', dh.room
                         ) ORDER BY h.name_en)
                    FROM doctor_hospitals dh
                    JOIN hospitals h ON h.id = dh.hospital_id
                    JOIN departments dep ON dep.id = dh.department_id
                   WHERE dh.doctor_id = d.id
                     AND dh.deleted_at IS NULL AND dh.is_active
                     AND h.is_live AND h.deleted_at IS NULL),
                 '[]'::jsonb
               ) AS chambers
          FROM doctors d
         WHERE d.deleted_at IS NULL
           AND d.bmdc_verified_at IS NOT NULL
           AND (%(specialty)s::text IS NULL
                OR EXISTS (SELECT 1 FROM departments dep2
                            JOIN doctor_hospitals dh2 ON dh2.department_id = dep2.id
                           WHERE dh2.doctor_id = d.id AND dep2.code = %(specialty)s))
           AND (%(hospital_id)s::uuid IS NULL
                OR EXISTS (SELECT 1 FROM doctor_hospitals dh3
                           WHERE dh3.doctor_id = d.id
                             AND dh3.hospital_id = %(hospital_id)s::uuid
                             AND dh3.deleted_at IS NULL AND dh3.is_active))
           AND (
             %(q)s::text IS NULL
             OR d.full_name_en ILIKE '%%' || %(q)s || '%%'
             OR d.full_name_bn LIKE '%%' || %(q)s || '%%'
           )
         ORDER BY d.full_name_en
         LIMIT %(limit)s
        """,
        {"specialty": specialty, "hospital_id": hospital_id, "q": q, "limit": limit},
    )
    return [
        {
            "id": r["id"],
            "nameBn": r["full_name_bn"],
            "nameEn": r["full_name_en"],
            "degrees": r["degrees"],
            "specialties": r["specialties"],
            "bmdcVerifiedAt": _iso(r["bmdc_verified_at"]),
            "consultMinutes": r["default_consult_minutes"],
            "chambers": r["chambers"] or [],
        }
        for r in rows
    ]


def list_bookable_sessions(
    *, from_date: str, days: int, doctor_id: str | None = None, hospital_id: str | None = None
) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT s.id, s.hospital_id,
               h.name_bn AS hospital_name_bn, h.name_en AS hospital_name_en,
               s.doctor_id,
               d.full_name_bn AS doctor_name_bn, d.full_name_en AS doctor_name_en,
               dep.code AS department_code,
               s.session_date::text AS session_date,
               s.planned_start, s.planned_end, s.status::text AS status,
               s.room, s.fee_poisha, s.capacity,
               (SELECT c.taken FROM fn_chamber_counts(s.id) c)::text AS taken,
               fn_publishes(s.hospital_id, 'serials') AS serials_shared,
               fn_offers_arrival_windows(s.hospital_id) AS offers_windows
          FROM sessions s
          JOIN hospitals h ON h.id = s.hospital_id
          JOIN doctors d ON d.id = s.doctor_id
          JOIN departments dep ON dep.id = s.department_id
         WHERE s.deleted_at IS NULL
           AND h.is_live
           AND fn_module_on(s.hospital_id, 'queue')
           AND s.session_date >= %(from)s::date
           AND s.session_date < %(from)s::date + %(days)s::integer
           AND s.status IN ('scheduled', 'running', 'paused')
           AND (%(doctor)s::uuid IS NULL OR s.doctor_id = %(doctor)s::uuid)
           AND (%(hospital)s::uuid IS NULL OR s.hospital_id = %(hospital)s::uuid)
         ORDER BY s.session_date, s.planned_start
        """,
        {"from": from_date, "days": days, "doctor": doctor_id, "hospital": hospital_id},
    )
    return [
        {
            "id": r["id"],
            "hospitalId": r["hospital_id"],
            "hospitalNameBn": r["hospital_name_bn"],
            "hospitalNameEn": r["hospital_name_en"],
            "doctorId": r["doctor_id"],
            "doctorNameBn": r["doctor_name_bn"],
            "doctorNameEn": r["doctor_name_en"],
            "departmentCode": r["department_code"],
            "sessionDate": r["session_date"],
            "plannedStart": from_datetime(r["planned_start"]),
            "plannedEnd": from_datetime(r["planned_end"]),
            "status": r["status"],
            "room": r["room"],
            "feePoisha": r["fee_poisha"],
            "capacity": r["capacity"],
            "taken": int(r["taken"]) if r["serials_shared"] else None,
            "full": r["capacity"] is not None and int(r["taken"]) >= r["capacity"],
            "offersArrivalWindow": r["offers_windows"],
        }
        for r in rows
    ]


def find_scope(code: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT h.id, h.code, h.name_bn, h.name_en, hs.brand, h.description_bn, h.description_en,
               left(l.sha256, 16) AS logo_version, l.content_type AS logo_type,
               encode(substring(l.bytes from 1 for 24), 'hex') AS logo_head,
               coalesce(hs.modules_off, '{}'::text[]) AS modules_off,
               coalesce(hs.unpublished, '{}'::text[]) AS unpublished
          FROM hospitals h
          LEFT JOIN hospital_settings hs ON hs.hospital_id = h.id
          LEFT JOIN hospital_logos l ON l.hospital_id = h.id
         WHERE h.code = %s AND h.deleted_at IS NULL AND h.is_live
        """,
        [code],
    )
    if row is None:
        return None
    return {
        "id": row["id"],
        "code": row["code"],
        "nameBn": row["name_bn"],
        "nameEn": row["name_en"],
        "brand": row["brand"],
        "descriptionBn": row["description_bn"],
        "descriptionEn": row["description_en"],
        "logoVersion": row["logo_version"],
        "logoType": row["logo_type"],
        "logoHeadHex": row["logo_head"],
        "modulesOff": list(row["modules_off"]),
        "unpublished": list(row["unpublished"]),
    }


def portal_domains() -> list[dict[str, Any]]:
    """Every live hospital's own portal domain (`FR-BRD-07`)."""
    rows = db.fetch_all(
        """
        SELECT h.portal_domain, h.code, h.id
          FROM hospitals h
         WHERE h.portal_domain IS NOT NULL AND h.code IS NOT NULL
           AND h.deleted_at IS NULL AND h.is_live
        """
    )
    return [{"domain": r["portal_domain"], "code": r["code"], "hospitalId": r["id"]} for r in rows]


def find_logo(hospital_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT l.content_type, l.bytes, l.sha256
          FROM hospital_logos l
          JOIN hospitals h ON h.id = l.hospital_id
         WHERE l.hospital_id = %s AND h.deleted_at IS NULL AND h.is_live
        """,
        [hospital_id],
    )
    if row is None:
        return None
    return {"contentType": row["content_type"], "bytes": bytes(row["bytes"]), "version": row["sha256"][:16]}


def find_hospital(hospital_id: str) -> dict[str, Any] | None:
    present = db.fetch_one(
        "SELECT id FROM hospitals WHERE id = %s AND deleted_at IS NULL AND is_live", [hospital_id]
    )
    if present is None:
        return None
    return next((h for h in list_hospitals(limit=500) if h["id"] == hospital_id), None)
