"""Referrals between emergency departments (port of `repositories/referral.repo.ts`; FR-EMG-07..09)."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from ..core import db
from ..domain.time import from_datetime


def _iso(value: datetime | None) -> str | None:
    return None if value is None else from_datetime(value)


_REFERRAL_SELECT = """
  SELECT r.id, r.state::text AS state, r.emergency_case_id, r.arrived_case_id,
         r.required_capability::text AS required_capability,
         r.required_bed_kind::text AS required_bed_kind, r.summary,
         r.sent_at, r.seen_at, r.responded_at, r.arrived_at, r.closed_at, r.decline_reason,
         r.from_hospital_id, fh.name_bn AS from_name_bn, fh.name_en AS from_name_en,
         COALESCE(fh.emergency_phone, fh.phone) AS from_phone,
         r.to_hospital_id, th.name_bn AS to_name_bn, th.name_en AS to_name_en,
         COALESCE(th.emergency_phone, th.phone) AS to_phone,
         fc.token_label AS from_token_label, ac.token_label AS arrived_token_label
    FROM referrals r
    JOIN hospitals fh ON fh.id = r.from_hospital_id
    JOIN hospitals th ON th.id = r.to_hospital_id
    LEFT JOIN emergency_cases fc ON fc.id = r.emergency_case_id
    LEFT JOIN emergency_cases ac ON ac.id = r.arrived_case_id
"""


def _to_view(r: dict[str, Any]) -> dict[str, Any]:
    summary = r["summary"] or {}
    return {
        "id": r["id"],
        "from": {
            "hospitalId": r["from_hospital_id"],
            "nameBn": r["from_name_bn"],
            "nameEn": r["from_name_en"],
            "phone": r["from_phone"],
        },
        "to": {"hospitalId": r["to_hospital_id"], "nameBn": r["to_name_bn"], "nameEn": r["to_name_en"], "phone": r["to_phone"]},
        "emergencyCaseId": r["emergency_case_id"],
        "fromTokenLabel": r["from_token_label"],
        "arrivedCaseId": r["arrived_case_id"],
        "arrivedTokenLabel": r["arrived_token_label"],
        "requiredCapability": r["required_capability"],
        "requiredBedKind": r["required_bed_kind"],
        "summary": {
            "problem": summary.get("problem") if summary.get("problem") is not None else "other",
            "triage": summary.get("triage"),
            "ageYears": summary.get("ageYears"),
            "sex": summary.get("sex"),
            "note": summary.get("note"),
        },
        "state": r["state"],
        "sentAt": from_datetime(r["sent_at"]),
        "seenAt": _iso(r["seen_at"]),
        "respondedAt": _iso(r["responded_at"]),
        "arrivedAt": _iso(r["arrived_at"]),
        "closedAt": _iso(r["closed_at"]),
        "declineReason": r["decline_reason"],
    }


def find_referral(referral_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(_REFERRAL_SELECT + " WHERE r.id = %s::uuid AND r.deleted_at IS NULL", [referral_id])
    return None if row is None else _to_view(row)


def lock_referral(referral_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        _REFERRAL_SELECT + " WHERE r.id = %s::uuid AND r.deleted_at IS NULL FOR UPDATE OF r", [referral_id]
    )
    return None if row is None else _to_view(row)


def lock_idempotency_key(key: str) -> None:
    db.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", [f"referral-key:{key}"])


def find_by_idempotency_key(key: str) -> dict[str, Any] | None:
    row = db.fetch_one(_REFERRAL_SELECT + " WHERE r.idempotency_key = %s", [key])
    return None if row is None else _to_view(row)


def open_referral_of(case_id: str) -> str | None:
    return db.fetch_value(
        "SELECT id FROM referrals WHERE emergency_case_id = %s::uuid AND closed_at IS NULL AND deleted_at IS NULL",
        [case_id],
    )


def insert_referral(
    *,
    from_hospital_id: str,
    to_hospital_id: str,
    emergency_case_id: str,
    required_capability: str | None,
    required_bed_kind: str | None,
    summary: dict[str, Any],
    idempotency_key: str | None,
    created_by: str,
) -> str:
    referral_id = db.fetch_value(
        """
        INSERT INTO referrals
          (from_hospital_id, to_hospital_id, emergency_case_id, required_capability,
           required_bed_kind, summary, idempotency_key, created_by)
        VALUES (%s::uuid, %s::uuid, %s::uuid, %s::capability_kind, %s::bed_kind, %s::jsonb, %s, %s::uuid)
        RETURNING id
        """,
        [
            from_hospital_id,
            to_hospital_id,
            emergency_case_id,
            required_capability,
            required_bed_kind,
            json.dumps(summary, ensure_ascii=False, separators=(",", ":")),
            idempotency_key,
            created_by,
        ],
    )
    if referral_id is None:
        raise RuntimeError("referrals insert returned no id.")
    return referral_id


def write_referral(referral_id: str, write: dict[str, Any]) -> None:
    db.execute(
        """
        UPDATE referrals
           SET state           = %(state)s::referral_state,
               seen_at         = CASE WHEN %(seen)s THEN coalesce(seen_at, now()) ELSE seen_at END,
               responded_at    = CASE WHEN %(responded)s THEN now() ELSE responded_at END,
               responded_by    = coalesce(%(responded_by)s::uuid, responded_by),
               decline_reason  = coalesce(%(decline)s, decline_reason),
               arrived_case_id = coalesce(%(arrived_case)s::uuid, arrived_case_id),
               arrived_at      = CASE WHEN %(arrived)s THEN now() ELSE arrived_at END,
               closed_at       = CASE WHEN %(closed)s THEN now() ELSE closed_at END
         WHERE id = %(id)s::uuid
        """,
        {
            "state": write["state"],
            "seen": write.get("seen") is True,
            "responded": "respondedBy" in write,
            "responded_by": write.get("respondedBy"),
            "decline": write.get("declineReason"),
            "arrived_case": write.get("arrivedCaseId"),
            "arrived": "arrivedCaseId" in write,
            "closed": write.get("closed") is True,
            "id": referral_id,
        },
    )


def referrals_at(hospital_id: str, today: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        _REFERRAL_SELECT
        + """
         WHERE (r.from_hospital_id = %(h)s::uuid OR r.to_hospital_id = %(h)s::uuid)
           AND r.deleted_at IS NULL
           AND (r.closed_at IS NULL OR (r.closed_at AT TIME ZONE 'Asia/Dhaka')::date = %(today)s::date)
         ORDER BY r.sent_at DESC, r.id
        """,
        {"h": hospital_id, "today": today},
    )
    return [_to_view(r) for r in rows]
