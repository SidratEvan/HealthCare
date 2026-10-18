"""Emergency desks, capabilities and cases (port of `repositories/emergency.repo.ts`;
FR-EMG-*, FR-PAT-40..46)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ..core import db
from ..domain.time import from_datetime


def _iso(value: datetime | None) -> str | None:
    return None if value is None else from_datetime(value)


def _to_hospital(r: dict[str, Any], id_key: str = "id") -> dict[str, Any]:
    return {
        "id": r[id_key],
        "nameBn": r["name_bn"],
        "nameEn": r["name_en"],
        "addressBn": r["address_bn"],
        "addressEn": r["address_en"],
        "lat": r["lat"],
        "lng": r["lng"],
        "emergencyPhone": r["emergency_phone"],
    }


def er_hospitals(only_ids: list[str] | None = None) -> list[dict[str, Any]]:
    """Live hospitals that run an emergency desk and the emergency module."""
    rows = db.fetch_all(
        """
        SELECT h.id, h.name_bn, h.name_en, h.address_bn, h.address_en, h.lat, h.lng,
               COALESCE(h.emergency_phone, h.phone) AS emergency_phone
          FROM hospitals h
         WHERE h.deleted_at IS NULL
           AND h.is_live
           AND (%s::boolean OR h.id = ANY(%s::uuid[]))
           AND fn_runs_emergency_desk(h.id)
           AND fn_module_on(h.id, 'emergency')
         ORDER BY h.id
        """,
        [only_ids is None, list(only_ids or [])],
    )
    return [_to_hospital(r) for r in rows]


def has_emergency_desk(hospital_id: str) -> bool:
    return len(er_hospitals([hospital_id])) > 0


def nearby(*, lat: float, lng: float, capability: str | None, radius_metres: float) -> dict[str, dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT hospital_id, distance_m, has_capability
          FROM fn_nearby_hospitals(%s::double precision, %s::double precision,
                                   %s::capability_kind, %s::double precision)
        """,
        [lat, lng, capability, radius_metres],
    )
    return {
        r["hospital_id"]: {"distanceMetres": float(r["distance_m"]), "hasCapability": r["has_capability"]}
        for r in rows
    }


def capable_now(hospital_ids: list[str], capability: str) -> set[str]:
    if not hospital_ids:
        return set()
    rows = db.fetch_all(
        """
        SELECT hospital_id FROM capabilities
         WHERE hospital_id = ANY(%s::uuid[]) AND kind = %s::capability_kind AND is_available
        """,
        [list(hospital_ids), capability],
    )
    return {r["hospital_id"] for r in rows}


def distance_to(hospital_id: str, *, lat: float, lng: float) -> float | None:
    value = db.fetch_value(
        """
        SELECT ST_Distance(h.geo, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography) AS distance_m
          FROM hospitals h
         WHERE h.id = %s::uuid AND h.geo IS NOT NULL
        """,
        [lng, lat, hospital_id],
    )
    return None if value is None else float(value)


def emergency_figures(hospital_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not hospital_ids:
        return {}
    rows = db.fetch_all(
        """
        SELECT hospital_id, er_active, capabilities, capability_as_of
          FROM v_public_hospital_capacity
         WHERE hospital_id = ANY(%s::uuid[])
        """,
        [list(hospital_ids)],
    )
    return {
        r["hospital_id"]: {
            "erActive": r["er_active"],
            "capabilities": r["capabilities"],
            "capabilityAsOf": _iso(r["capability_as_of"]),
        }
        for r in rows
    }


def stale_thresholds(hospital_ids: list[str]) -> dict[str, int]:
    if not hospital_ids:
        return {}
    rows = db.fetch_all(
        "SELECT hospital_id, stale_threshold_minutes FROM hospital_settings WHERE hospital_id = ANY(%s::uuid[])",
        [list(hospital_ids)],
    )
    return {r["hospital_id"]: r["stale_threshold_minutes"] for r in rows}


def bed_kinds_at(hospital_id: str) -> list[str]:
    rows = db.fetch_all(
        "SELECT DISTINCT kind::text AS kind FROM beds WHERE hospital_id = %s::uuid AND deleted_at IS NULL ORDER BY 1",
        [hospital_id],
    )
    return [r["kind"] for r in rows]


def capabilities_of(hospital_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT kind::text AS kind, is_available, updated_at
          FROM capabilities WHERE hospital_id = %s::uuid ORDER BY kind
        """,
        [hospital_id],
    )
    return [{"kind": r["kind"], "available": r["is_available"], "updatedAt": from_datetime(r["updated_at"])} for r in rows]


def confirm_capabilities(*, hospital_id: str, entries: list[dict[str, Any]], staff_user_id: str) -> None:
    for entry in entries:
        db.execute(
            """
            UPDATE capabilities
               SET is_available = %s, updated_by = %s::uuid
             WHERE hospital_id = %s::uuid AND kind = %s::capability_kind
            """,
            [entry["available"], staff_user_id, hospital_id, entry["kind"]],
        )


_CASE_COLUMNS = """
  ec.id, ec.hospital_id, ec.patient_id, ec.state::text AS state, ec.problem_type,
  ec.triage::text AS triage, ec.token_label, ec.patient_age_years,
  ec.patient_sex::text AS patient_sex, (ec.contact_phone IS NOT NULL) AS has_phone,
  ec.inbound_at, ec.inbound_eta_minutes, ec.acknowledged_at, ec.arrived_at, ec.closed_at,
  ec.decline_reason, ec.admit_bed_kind::text AS admit_bed_kind, ec.admit_requested_at,
  ec.created_at, ec.version::text AS version
"""


def _to_case(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r["id"],
        "hospitalId": r["hospital_id"],
        "patientId": r["patient_id"],
        "state": r["state"],
        "problem": r["problem_type"],
        "triage": r["triage"],
        "tokenLabel": r["token_label"],
        "ageYears": r["patient_age_years"],
        "sex": r["patient_sex"],
        "hasPhone": r["has_phone"],
        "inboundAt": _iso(r["inbound_at"]),
        "inboundEtaMinutes": r["inbound_eta_minutes"],
        "acknowledgedAt": _iso(r["acknowledged_at"]),
        "arrivedAt": _iso(r["arrived_at"]),
        "closedAt": _iso(r["closed_at"]),
        "declineReason": r["decline_reason"],
        "admitBedKind": r["admit_bed_kind"],
        "admitRequestedAt": _iso(r["admit_requested_at"]),
        "createdAt": from_datetime(r["created_at"]),
        "version": int(r["version"]),
    }


def find_case(case_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        f"SELECT {_CASE_COLUMNS} FROM emergency_cases ec WHERE ec.id = %s::uuid AND ec.deleted_at IS NULL", [case_id]
    )
    return None if row is None else _to_case(row)


def lock_case(case_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        f"SELECT {_CASE_COLUMNS} FROM emergency_cases ec WHERE ec.id = %s::uuid AND ec.deleted_at IS NULL FOR UPDATE",
        [case_id],
    )
    return None if row is None else _to_case(row)


def lock_idempotency_key(key: str) -> None:
    db.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", [f"er-key:{key}"])


def find_by_idempotency_key(key: str) -> dict[str, Any] | None:
    row = db.fetch_one(f"SELECT {_CASE_COLUMNS} FROM emergency_cases ec WHERE ec.idempotency_key = %s", [key])
    return None if row is None else _to_case(row)


def open_cases(hospital_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        f"""
        SELECT {_CASE_COLUMNS} FROM emergency_cases ec
         WHERE ec.hospital_id = %s::uuid AND ec.closed_at IS NULL AND ec.deleted_at IS NULL
         ORDER BY ec.created_at
        """,
        [hospital_id],
    )
    return [_to_case(r) for r in rows]


def handoffs(hospital_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        f"""
        SELECT {_CASE_COLUMNS} FROM emergency_cases ec
         WHERE ec.hospital_id = %s::uuid
           AND ec.admit_requested_at IS NOT NULL
           AND ec.closed_at IS NULL
           AND ec.deleted_at IS NULL
         ORDER BY ec.admit_requested_at
        """,
        [hospital_id],
    )
    return [_to_case(r) for r in rows]


def contact_of(case_id: str) -> str | None:
    return db.fetch_value(
        "SELECT contact_phone FROM emergency_cases WHERE id = %s::uuid AND deleted_at IS NULL", [case_id]
    )


def insert_inbound(
    *,
    hospital_id: str,
    problem: str,
    eta_minutes: int | None,
    phone: str | None,
    age_years: int | None,
    sex: str | None,
    idempotency_key: str | None,
) -> str:
    case_id = db.fetch_value(
        """
        INSERT INTO emergency_cases
          (hospital_id, problem_type, state, inbound_at, inbound_eta_minutes,
           contact_phone, patient_age_years, patient_sex, idempotency_key)
        VALUES (%s::uuid, %s, 'inbound', now(), %s, %s, %s, %s::sex, %s)
        RETURNING id
        """,
        [hospital_id, problem, eta_minutes, phone, age_years, sex, idempotency_key],
    )
    if case_id is None:
        raise RuntimeError("emergency_cases insert returned no id.")
    return case_id


def insert_walk_in(
    *,
    hospital_id: str,
    problem: str,
    triage: str | None,
    token_label: str,
    phone: str | None,
    age_years: int | None,
    sex: str | None,
    idempotency_key: str | None,
    created_by: str,
) -> str:
    case_id = db.fetch_value(
        """
        INSERT INTO emergency_cases
          (hospital_id, problem_type, state, arrived_at, token_label, triage,
           contact_phone, patient_age_years, patient_sex, idempotency_key, created_by)
        VALUES (%s::uuid, %s, 'arrived', now(), %s, %s::triage_color, %s, %s, %s::sex, %s, %s::uuid)
        RETURNING id
        """,
        [hospital_id, problem, token_label, triage, phone, age_years, sex, idempotency_key, created_by],
    )
    if case_id is None:
        raise RuntimeError("emergency_cases insert returned no id.")
    return case_id


def write_case(case_id: str, write: dict[str, Any]) -> None:
    """Writes the fields given; an absent field keeps its value."""
    db.execute(
        """
        UPDATE emergency_cases
           SET state              = coalesce(%(state)s::emergency_state, state),
               triage             = coalesce(%(triage)s::triage_color, triage),
               token_label        = coalesce(%(token)s, token_label),
               acknowledged_at    = CASE WHEN %(ack)s THEN now() ELSE acknowledged_at END,
               arrived_at         = CASE WHEN %(arrived)s THEN now() ELSE arrived_at END,
               closed_at          = CASE WHEN %(closed)s THEN now() ELSE closed_at END,
               decline_reason     = coalesce(%(decline)s, decline_reason),
               admit_bed_kind     = coalesce(%(bed_kind)s::bed_kind, admit_bed_kind),
               admit_requested_at = CASE
                                      WHEN %(admit)s THEN coalesce(admit_requested_at, now())
                                      ELSE admit_requested_at
                                    END,
               patient_id         = coalesce(%(patient)s::uuid, patient_id)
         WHERE id = %(id)s::uuid
        """,
        {
            "state": write.get("state"),
            "triage": write.get("triage"),
            "token": write.get("tokenLabel"),
            "ack": write.get("acknowledged") is True,
            "arrived": write.get("arrived") is True,
            "closed": write.get("closed") is True,
            "decline": write.get("declineReason"),
            "bed_kind": write.get("admitBedKind"),
            "admit": "admitBedKind" in write,
            "patient": write.get("patientId"),
            "id": case_id,
        },
    )


def token_context(hospital_id: str, today: str) -> dict[str, Any]:
    db.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", [f"er-token:{hospital_id}"])
    counted = db.fetch_value(
        """
        SELECT count(*)::text AS n FROM emergency_cases
         WHERE hospital_id = %s::uuid
           AND arrived_at IS NOT NULL
           AND (arrived_at AT TIME ZONE 'Asia/Dhaka')::date = %s::date
        """,
        [hospital_id, today],
    )
    open_rows = db.fetch_all(
        """
        SELECT token_label FROM emergency_cases
         WHERE hospital_id = %s::uuid
           AND closed_at IS NULL AND token_label IS NOT NULL AND deleted_at IS NULL
        """,
        [hospital_id],
    )
    return {"arrivedToday": int(counted or "0"), "openLabels": {r["token_label"] for r in open_rows}}


def case_status(case_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT ec.id, ec.state::text AS state, ec.problem_type, ec.inbound_at,
               ec.inbound_eta_minutes, ec.acknowledged_at, ec.arrived_at, ec.closed_at,
               ec.decline_reason, h.id AS hospital_id, h.name_bn, h.name_en, h.address_bn, h.address_en,
               h.lat, h.lng, COALESCE(h.emergency_phone, h.phone) AS emergency_phone
          FROM emergency_cases ec
          JOIN hospitals h ON h.id = ec.hospital_id
         WHERE ec.id = %s::uuid AND ec.deleted_at IS NULL
        """,
        [case_id],
    )
    if row is None:
        return None
    return {
        "id": row["id"],
        "state": row["state"],
        "problem": row["problem_type"],
        "inboundAt": _iso(row["inbound_at"]),
        "inboundEtaMinutes": row["inbound_eta_minutes"],
        "acknowledgedAt": _iso(row["acknowledged_at"]),
        "arrivedAt": _iso(row["arrived_at"]),
        "closedAt": _iso(row["closed_at"]),
        "declineReason": row["decline_reason"],
        "hospital": _to_hospital(row, "hospital_id"),
    }
