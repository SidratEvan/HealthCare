"""The platform administrator's view of every workspace (port of `repositories/platform.repo.ts`;
FR-ONB-*, FR-NET-*)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ..core import db
from ..domain.time import from_datetime

_COUNTS = """
  (SELECT count(*) FROM departments dep
    WHERE dep.hospital_id = h.id AND dep.deleted_at IS NULL)::int AS departments,
  (SELECT count(*) FROM doctor_hospitals dh
    WHERE dh.hospital_id = h.id AND dh.deleted_at IS NULL AND dh.is_active)::int AS doctors,
  (SELECT count(*) FROM doctor_hospitals dh
     JOIN doctors d ON d.id = dh.doctor_id
    WHERE dh.hospital_id = h.id AND dh.deleted_at IS NULL AND dh.is_active
      AND d.deleted_at IS NULL AND d.bmdc_verified_at IS NOT NULL)::int AS verified_doctors,
  (SELECT count(*) FROM session_templates st
     JOIN doctor_hospitals dh ON dh.id = st.doctor_hospital_id
    WHERE dh.hospital_id = h.id AND dh.deleted_at IS NULL AND st.deleted_at IS NULL)::int AS schedules,
  (SELECT count(*) FROM beds b
    WHERE b.hospital_id = h.id AND b.deleted_at IS NULL)::int AS beds,
  (SELECT count(*) FROM staff_users su
    WHERE su.hospital_id = h.id AND su.deleted_at IS NULL AND su.is_active)::int AS staff,
  (CASE WHEN h.phone IS NOT NULL AND coalesce(h.address_bn, h.address_en) IS NOT NULL
        THEN 1 ELSE 0 END)::int AS contact,
  (CASE WHEN h.lat IS NOT NULL AND h.lng IS NOT NULL THEN 1 ELSE 0 END)::int AS location,
  (CASE WHEN fn_module_on(h.id, 'emergency')
        THEN (SELECT count(*) FROM capabilities c WHERE c.hospital_id = h.id)::int
        ELSE NULL END) AS capabilities
"""

_WORKSPACE_COLUMNS = """
  h.id, h.code, h.name_bn, h.name_en, h.kind::text AS kind, h.division, h.district,
  h.registration_no, h.self_registered, h.portal_domain,
  coalesce((SELECT s.modules_off FROM hospital_settings s WHERE s.hospital_id = h.id),
           '{}'::text[]) AS modules_off,
  h.lifecycle::text AS lifecycle, h.is_live,
  h.review_requested_at, h.reviewed_at, h.review_note, h.created_at,
  h.agreement_state::text AS agreement_state, h.agreement_note, h.agreement_changed_at
"""


def _iso(value: datetime | None) -> str | None:
    return None if value is None else from_datetime(value)


def _counts_of(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "departments": r["departments"],
        "doctors": r["doctors"],
        "verifiedDoctors": r["verified_doctors"],
        "schedules": r["schedules"],
        "beds": r["beds"],
        "staff": r["staff"],
        "contact": r["contact"],
        "location": r["location"],
        "capabilities": r["capabilities"],
    }


def setup_counts(hospital_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(f"SELECT {_COUNTS} FROM hospitals h WHERE h.id = %s AND h.deleted_at IS NULL", [hospital_id])
    return None if row is None else _counts_of(row)


def _workspace_of(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r["id"],
        "code": r["code"],
        "nameBn": r["name_bn"],
        "nameEn": r["name_en"],
        "kind": r["kind"],
        "division": r["division"],
        "district": r["district"],
        "registrationNo": r["registration_no"],
        "selfRegistered": r["self_registered"],
        "portalDomain": r["portal_domain"],
        "modulesOff": list(r["modules_off"]),
        "lifecycle": r["lifecycle"],
        "isLive": r["is_live"],
        "reviewRequestedAt": _iso(r["review_requested_at"]),
        "reviewedAt": _iso(r["reviewed_at"]),
        "reviewNote": r["review_note"],
        "createdAt": from_datetime(r["created_at"]),
        "counts": _counts_of(r),
        "agreement": {
            "state": r["agreement_state"],
            "note": r["agreement_note"],
            "changedAt": _iso(r["agreement_changed_at"]),
        },
    }


def set_agreement(*, hospital_id: str, state: str, note: str | None, changed_by: str) -> bool:
    rows = db.fetch_all(
        """
        UPDATE hospitals
           SET agreement_state = %s::agreement_state,
               agreement_note = %s,
               agreement_changed_at = now(),
               agreement_changed_by = %s::uuid,
               updated_at = now()
         WHERE id = %s AND deleted_at IS NULL
        RETURNING id
        """,
        [state, note, changed_by, hospital_id],
    )
    return len(rows) == 1


def usage_of(hospital_id: str) -> dict[str, Any]:
    row = db.fetch_one(
        "SELECT serials_30d, chambers_30d, messages_month FROM fn_workspace_usage(%s::uuid)", [hospital_id]
    )
    row = row or {}
    return {
        "serialsTaken30d": _or0(row.get("serials_30d")),
        "chambersHeld30d": _or0(row.get("chambers_30d")),
        "messagesSentThisMonth": _or0(row.get("messages_month")),
    }


def _or0(value: Any) -> Any:
    return 0 if value is None else value


def list_workspaces() -> list[dict[str, Any]]:
    rows = db.fetch_all(
        f"""
        SELECT {_WORKSPACE_COLUMNS}, {_COUNTS}
          FROM hospitals h
         WHERE h.deleted_at IS NULL
         ORDER BY (h.lifecycle = 'ready_for_review') DESC,
                  h.review_requested_at NULLS LAST,
                  h.created_at DESC
        """
    )
    return [_workspace_of(r) for r in rows]


def find_workspace(hospital_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        f"""
        SELECT {_WORKSPACE_COLUMNS}, {_COUNTS}
          FROM hospitals h
         WHERE h.id = %s AND h.deleted_at IS NULL
        """,
        [hospital_id],
    )
    return None if row is None else _workspace_of(row)


def hospital_with_domain(domain: str) -> str | None:
    return db.fetch_value("SELECT id FROM hospitals WHERE portal_domain = %s AND deleted_at IS NULL", [domain])


def set_portal_domain(hospital_id: str, domain: str | None) -> None:
    db.execute(
        "UPDATE hospitals SET portal_domain = %s, updated_at = now() WHERE id = %s AND deleted_at IS NULL",
        [domain, hospital_id],
    )


def doctors_of(hospital_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT DISTINCT d.id, d.full_name_bn, d.full_name_en, d.bmdc_number, d.degrees,
               d.bmdc_verified_at
          FROM doctor_hospitals dh
          JOIN doctors d ON d.id = dh.doctor_id
         WHERE dh.hospital_id = %s AND dh.deleted_at IS NULL AND dh.is_active
           AND d.deleted_at IS NULL
         ORDER BY d.full_name_en
        """,
        [hospital_id],
    )
    return [
        {
            "doctorId": r["id"],
            "nameBn": r["full_name_bn"],
            "nameEn": r["full_name_en"],
            "bmdcNumber": r["bmdc_number"],
            "degrees": r["degrees"],
            "verifiedAt": _iso(r["bmdc_verified_at"]),
        }
        for r in rows
    ]


def facility_phone_of(hospital_id: str) -> str | None:
    return db.fetch_value("SELECT phone FROM hospitals WHERE id = %s AND deleted_at IS NULL", [hospital_id])


def administrators_of(hospital_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT su.full_name, su.email, su.phone
          FROM staff_users su
          JOIN staff_roles sr ON sr.staff_user_id = su.id AND sr.hospital_id = su.hospital_id
         WHERE su.hospital_id = %s AND su.deleted_at IS NULL AND su.is_active
           AND sr.role = 'hospital_admin' AND sr.deleted_at IS NULL
         ORDER BY su.created_at
        """,
        [hospital_id],
    )
    return [{"fullName": r["full_name"], "email": r["email"], "phone": r["phone"]} for r in rows]


_NOT_GIVEN: Any = object()


def move_lifecycle(
    *, hospital_id: str, frm: str, to: str, reviewed_by: str | None, note: Any = _NOT_GIVEN
) -> bool:
    live = to == "active"
    requested = to == "ready_for_review"
    rows = db.fetch_all(
        """
        UPDATE hospitals
           SET lifecycle = %(to)s::org_lifecycle,
               is_live = %(live)s,
               onboarded_at = CASE WHEN %(live)s THEN coalesce(onboarded_at, now()) ELSE onboarded_at END,
               review_requested_at = CASE WHEN %(requested)s THEN now() ELSE review_requested_at END,
               reviewed_at = CASE WHEN %(by)s::uuid IS NULL THEN reviewed_at ELSE now() END,
               reviewed_by = coalesce(%(by)s::uuid, reviewed_by),
               review_note = CASE WHEN %(has_note)s THEN %(note)s ELSE review_note END,
               updated_at = now()
         WHERE id = %(id)s
           AND lifecycle = %(from)s::org_lifecycle
           AND deleted_at IS NULL
        RETURNING id
        """,
        {
            "to": to,
            "live": live,
            "requested": requested,
            "by": reviewed_by,
            "has_note": note is not _NOT_GIVEN,
            "note": None if note is _NOT_GIVEN else note,
            "id": hospital_id,
            "from": frm,
        },
    )
    return len(rows) == 1


def set_registration_no(hospital_id: str, registration_no: str | None) -> None:
    db.execute(
        "UPDATE hospitals SET registration_no = %s, updated_at = now() WHERE id = %s", [registration_no, hospital_id]
    )


def verify_doctor_at(*, hospital_id: str, doctor_id: str) -> bool:
    rows = db.fetch_all(
        """
        UPDATE doctors d
           SET bmdc_verified_at = coalesce(d.bmdc_verified_at, now()), updated_at = now()
         WHERE d.id = %s AND d.deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM doctor_hospitals dh
                        WHERE dh.doctor_id = d.id AND dh.hospital_id = %s
                          AND dh.deleted_at IS NULL)
        RETURNING d.id
        """,
        [doctor_id, hospital_id],
    )
    return len(rows) == 1


def _health_of_row(r: dict[str, Any]) -> dict[str, Any]:
    stamps: list[dict[str, Any]] = []
    if r["reports_beds"]:
        stamps.append({"figure": "beds", "shared": r["shares_beds"], "asOf": _iso(r["beds_as_of"])})
    if r["reports_capabilities"]:
        stamps.append({"figure": "capabilities", "shared": True, "asOf": _iso(r["capabilities_as_of"])})
    return {
        "live": r["is_live"],
        "staleAfterMinutes": r["stale_after"],
        "stamps": stamps,
        "messages": {
            "sent": _or0(r["messages_sent"]),
            "failed": _or0(r["messages_failed"]),
            "held": _or0(r["messages_held"]),
            "waiting": _or0(r["messages_waiting"]),
        },
        "sync": {
            "lateActions": _or0(r["late_actions"]),
            "slowestSeconds": _or0(r["slowest_seconds"]),
            "lastLateAt": _iso(r["last_late_at"]),
        },
    }


def _health_rows(hospital_id: str | None) -> list[dict[str, Any]]:
    return db.fetch_all(
        """
        SELECT h.id, h.is_live,
               coalesce(s.stale_threshold_minutes, 10) AS stale_after,
               (fn_module_on(h.id, 'beds') AND coalesce(c.bed_total, 0) > 0) AS reports_beds,
               fn_publishes(h.id, 'beds') AS shares_beds,
               c.beds_as_of,
               (fn_module_on(h.id, 'emergency')
                 AND EXISTS (SELECT 1 FROM capabilities cp WHERE cp.hospital_id = h.id))
                 AS reports_capabilities,
               (SELECT min(cp.updated_at) FROM capabilities cp WHERE cp.hospital_id = h.id)
                 AS capabilities_as_of,
               w.messages_sent, w.messages_failed, w.messages_held, w.messages_waiting,
               w.late_actions, w.slowest_seconds, w.last_late_at
          FROM hospitals h
          LEFT JOIN hospital_settings s ON s.hospital_id = h.id
          LEFT JOIN v_public_hospital_capacity c ON c.hospital_id = h.id
          LEFT JOIN LATERAL fn_workspace_health(h.id) w ON true
         WHERE h.deleted_at IS NULL
           AND (%(h)s::uuid IS NULL OR h.id = %(h)s::uuid)
        """,
        {"h": hospital_id},
    )


def health_of(hospital_id: str) -> dict[str, Any] | None:
    rows = _health_rows(hospital_id)
    return None if not rows else _health_of_row(rows[0])


def health_of_all() -> dict[str, dict[str, Any]]:
    return {r["id"]: _health_of_row(r) for r in _health_rows(None)}


def audit_trail_of(hospital_id: str, limit: int) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT a.id, a.created_at,
               CASE a.action
                 WHEN 'SETTINGS_CHANGE' THEN a.meta ->> 'change'
                 WHEN 'IMPORT' THEN 'import_' || (a.meta ->> 'event')
                 ELSE 'export'
               END AS change,
               su.full_name AS actor_name,
               (su.id IS NOT NULL AND su.hospital_id IS NULL) AS by_platform
          FROM audit_log a
          LEFT JOIN staff_users su ON su.id = a.actor_staff_id
         WHERE a.hospital_id = %s::uuid
           AND a.action IN ('SETTINGS_CHANGE', 'IMPORT', 'EXPORT')
           AND a.patient_id IS NULL
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT %s
        """,
        [hospital_id, limit],
    )
    return [
        {
            "id": r["id"],
            "at": from_datetime(r["created_at"]),
            "change": r["change"] or "",
            "actorName": r["actor_name"],
            "byPlatform": r["by_platform"],
        }
        for r in rows
    ]
