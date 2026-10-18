"""Test orders, reports, and the pharmacy's shelf (port of `repositories/lab.repo.ts`;
FR-LAB-01..03, FR-PHR-01..02)."""

from __future__ import annotations

import math
from datetime import datetime
from typing import Any

from ..core import db
from ..core.errors import AppError
from ..domain.time import from_datetime


def _iso(value: datetime | None) -> str | None:
    return None if value is None else from_datetime(value)


_ORDER_SELECT = """
  SELECT t.id, t.hospital_id, t.patient_id, t.visit_id, t.test_code, t.test_name,
         t.state::text AS state, t.price_poisha,
         t.created_at AS ordered_at, t.sample_at, t.ready_at, t.delivered_at,
         r.id AS report_id, r.file_type AS report_file_type,
         r.created_at AS report_uploaded_at,
         r.delivered_to_wallet_at AS report_delivered_at
    FROM test_orders t
    LEFT JOIN LATERAL (
      SELECT id, file_type, created_at, delivered_to_wallet_at
        FROM reports
       WHERE test_order_id = t.id AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1
    ) r ON true
"""


def _to_view(row: dict[str, Any]) -> dict[str, Any]:
    report = (
        None
        if row["report_id"] is None
        else {
            "id": row["report_id"],
            "fileType": row["report_file_type"],
            "uploadedAt": _iso(row["report_uploaded_at"]) or from_datetime(row["ordered_at"]),
            "deliveredToWalletAt": _iso(row["report_delivered_at"]),
        }
    )
    return {
        "id": row["id"],
        "hospitalId": row["hospital_id"],
        "patientId": row["patient_id"],
        "visitId": row["visit_id"],
        "testCode": row["test_code"],
        "testName": row["test_name"],
        "state": row["state"],
        "pricePoisha": row["price_poisha"],
        "orderedAt": from_datetime(row["ordered_at"]),
        "sampleAt": _iso(row["sample_at"]),
        "readyAt": _iso(row["ready_at"]),
        "deliveredAt": _iso(row["delivered_at"]),
        "report": report,
    }


def find_test_order(order_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(_ORDER_SELECT + " WHERE t.id = %s::uuid AND t.deleted_at IS NULL", [order_id])
    return None if row is None else _to_view(row)


def lock_test_order(order_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(_ORDER_SELECT + " WHERE t.id = %s::uuid AND t.deleted_at IS NULL FOR UPDATE OF t", [order_id])
    return None if row is None else _to_view(row)


def list_lab_queue(*, hospital_id: str, states: list[str], since: datetime) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        _ORDER_SELECT
        + """
         WHERE t.hospital_id = %s::uuid
           AND t.deleted_at IS NULL
           AND t.state = ANY(%s::test_state[])
           AND t.created_at >= %s
         ORDER BY t.created_at DESC
         LIMIT 500
        """,
        [hospital_id, list(states), since],
    )
    return [_to_view(r) for r in rows]


def list_patient_test_orders(patient_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        _ORDER_SELECT + " WHERE t.patient_id = %s::uuid AND t.deleted_at IS NULL ORDER BY t.created_at DESC LIMIT 200",
        [patient_id],
    )
    return [_to_view(r) for r in rows]


def list_test_orders_for_booking(booking_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        _ORDER_SELECT
        + """
         JOIN visits v ON v.id = t.visit_id
         WHERE v.booking_id = %s::uuid AND v.deleted_at IS NULL AND t.deleted_at IS NULL
         ORDER BY t.created_at DESC
        """,
        [booking_id],
    )
    return [_to_view(r) for r in rows]


def patient_label(patient_id: str) -> str | None:
    return db.fetch_value("SELECT full_name FROM patients WHERE id = %s::uuid AND deleted_at IS NULL", [patient_id])


def lock_idempotency_key(key: str) -> None:
    db.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", [f"lab-key:{key}"])


def find_by_idempotency_key(key_prefix: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        _ORDER_SELECT + " WHERE t.idempotency_key LIKE %s ORDER BY t.created_at ASC", [f"{key_prefix}:%"]
    )
    return [_to_view(r) for r in rows]


def visit_for_booking(booking_id: str) -> dict[str, str] | None:
    row = db.fetch_one(
        "SELECT id, patient_id, hospital_id, doctor_id FROM visits WHERE booking_id = %s::uuid AND deleted_at IS NULL",
        [booking_id],
    )
    if row is None:
        return None
    return {
        "visitId": row["id"],
        "patientId": row["patient_id"],
        "hospitalId": row["hospital_id"],
        "doctorId": row["doctor_id"],
    }


def insert_test_order(
    *,
    visit_id: str,
    patient_id: str,
    hospital_id: str,
    test_code: str,
    test_name: str,
    price_poisha: int,
    ordered_by: str | None,
    idempotency_key: str | None,
) -> str:
    order_id = db.fetch_value(
        """
        INSERT INTO test_orders
          (visit_id, patient_id, hospital_id, test_code, test_name,
           price_poisha, ordered_by, created_by, idempotency_key)
        VALUES (%s::uuid, %s::uuid, %s::uuid, %s, %s, %s, %s::uuid, %s::uuid, %s)
        RETURNING id
        """,
        [visit_id, patient_id, hospital_id, test_code, test_name, price_poisha, ordered_by, ordered_by, idempotency_key],
    )
    if order_id is None:
        raise RuntimeError("insertTestOrder returned no row")
    return order_id


def set_test_order_state(*, order_id: str, state: str, at: datetime) -> None:
    db.execute(
        """
        UPDATE test_orders
           SET state = %(state)s::test_state,
               sample_at = CASE WHEN %(state)s::test_state = 'sample_collected'
                                THEN COALESCE(sample_at, %(at)s) ELSE sample_at END,
               ready_at  = CASE WHEN %(state)s::test_state = 'report_ready'
                                THEN COALESCE(ready_at, %(at)s) ELSE ready_at END,
               delivered_at = CASE WHEN %(state)s::test_state = 'delivered'
                                   THEN COALESCE(delivered_at, %(at)s) ELSE delivered_at END
         WHERE id = %(id)s::uuid
        """,
        {"state": state, "at": at, "id": order_id},
    )


def insert_report(
    *, test_order_id: str, file_url: str, file_type: str, uploaded_by: str | None, idempotency_key: str | None
) -> str:
    report_id = db.fetch_value(
        """
        INSERT INTO reports (test_order_id, file_url, file_type, uploaded_by, idempotency_key)
        VALUES (%s::uuid, %s, %s, %s::uuid, %s)
        RETURNING id
        """,
        [test_order_id, file_url, file_type, uploaded_by, idempotency_key],
    )
    if report_id is None:
        raise RuntimeError("insertReport returned no row")
    return report_id


def find_report_by_idempotency_key(key: str) -> dict[str, str] | None:
    row = db.fetch_one("SELECT id, file_url, test_order_id FROM reports WHERE idempotency_key = %s", [key])
    return None if row is None else {"id": row["id"], "fileUrl": row["file_url"], "testOrderId": row["test_order_id"]}


def mark_report_delivered(*, report_id: str, recipients: list[str], at: datetime) -> None:
    db.execute(
        """
        UPDATE reports
           SET delivered_to_wallet_at = COALESCE(delivered_to_wallet_at, %s),
               delivered_to = %s::text[]
         WHERE id = %s::uuid
        """,
        [at, list(recipients), report_id],
    )


def find_report_file(report_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT r.file_url, r.file_type, t.patient_id
          FROM reports r
          JOIN test_orders t ON t.id = r.test_order_id
         WHERE r.id = %s::uuid AND r.deleted_at IS NULL
        """,
        [report_id],
    )
    return None if row is None else {"fileUrl": row["file_url"], "fileType": row["file_type"], "patientId": row["patient_id"]}


def count_undelivered_reports(hospital_id: str) -> int:
    value = db.fetch_value(
        """
        SELECT count(*)::text AS count
          FROM reports r
          JOIN test_orders t ON t.id = r.test_order_id
         WHERE t.hospital_id = %s::uuid AND r.delivered_to_wallet_at IS NULL AND r.deleted_at IS NULL
        """,
        [hospital_id],
    )
    return int(value or "0")


_STOCK_STAMP = """to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')"""


def list_stock(hospital_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        f"""
        SELECT s.medicine_id, m.generic_name, m.brand_name, m.form, m.strengths,
               s.in_stock, {_STOCK_STAMP} AS updated_at
          FROM pharmacy_stock s
          JOIN medicines m ON m.id = s.medicine_id
         WHERE s.hospital_id = %s::uuid AND s.deleted_at IS NULL AND m.deleted_at IS NULL
         ORDER BY s.updated_at ASC, m.generic_name ASC
        """,
        [hospital_id],
    )
    return [
        {
            "medicineId": r["medicine_id"],
            "genericName": r["generic_name"],
            "brandName": r["brand_name"],
            "form": r["form"],
            "strengths": r["strengths"] or [],
            "inStock": r["in_stock"],
            "updatedAt": r["updated_at"],
        }
        for r in rows
    ]


def upsert_stock_flags(*, hospital_id: str, flags: list[dict[str, Any]], at: datetime, staff_user_id: str | None) -> int:
    """Writes the shelf, refusing when any row changed since the console read it (FR-PHR-02)."""
    db.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", [f"pharmacy:{hospital_id}"])
    medicine_ids = [flag["medicineId"] for flag in flags]
    current = db.fetch_all(
        """
        SELECT medicine_id,
               to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
          FROM pharmacy_stock
         WHERE hospital_id = %s::uuid AND deleted_at IS NULL
           AND medicine_id = ANY(%s::uuid[])
         ORDER BY medicine_id FOR UPDATE
        """,
        [hospital_id, medicine_ids],
    )
    versions = {r["medicine_id"]: r["updated_at"] for r in current}
    if len(set(medicine_ids)) != len(flags) or any(
        versions.get(flag["medicineId"]) != flag["expectedUpdatedAt"] for flag in flags
    ):
        raise AppError("WRITE_CONFLICT", details={"reason": "stock_changed_reload"})
    rows = db.fetch_all(
        """
        INSERT INTO pharmacy_stock (hospital_id, medicine_id, in_stock, created_by, updated_at)
        SELECT %(hospital)s::uuid, m.id, f.in_stock, %(staff)s::uuid, %(at)s
          FROM unnest(%(ids)s::uuid[], %(values)s::boolean[]) AS f(medicine_id, in_stock)
          JOIN medicines m ON m.id = f.medicine_id AND m.deleted_at IS NULL
        ON CONFLICT (hospital_id, medicine_id) WHERE deleted_at IS NULL
        DO UPDATE SET in_stock = EXCLUDED.in_stock, updated_at = %(at)s
        RETURNING medicine_id
        """,
        {
            "hospital": hospital_id,
            "staff": staff_user_id,
            "at": at,
            "ids": medicine_ids,
            "values": [bool(flag["inStock"]) for flag in flags],
        },
    )
    if len(rows) != len(flags):
        raise AppError("WRITE_CONFLICT", details={"reason": "medicine_unavailable"})
    return len(rows)


def search_medicine_availability(
    *, hospital_id: str | None, query: str, lat: float | None, lng: float | None, limit: int
) -> list[dict[str, Any]]:
    """Who has a medicine, capped per medicine so no medicine's answer is cut off (PRD.md §3.2)."""
    pattern = f"%{query.lower()}%"
    rows = db.fetch_all(
        """
        WITH matched AS (
          SELECT id, generic_name, brand_name, form
            FROM medicines
           WHERE deleted_at IS NULL
             AND (lower(generic_name) LIKE %(pattern)s OR lower(brand_name) LIKE %(pattern)s)
           ORDER BY lower(generic_name)
           LIMIT 10
        ),
        answers AS (
          SELECT h.id AS hospital_id, h.name_bn, h.name_en,
                 m.id AS medicine_id, m.generic_name, m.brand_name, m.form,
                 s.in_stock, s.updated_at,
                 CASE WHEN %(lat)s::double precision IS NULL OR h.geo IS NULL THEN NULL
                      ELSE ST_Distance(
                             h.geo,
                             ST_SetSRID(ST_MakePoint(%(lng0)s, %(lat0)s), 4326)::geography
                           )
                 END AS distance_m
            FROM matched m
            CROSS JOIN hospitals h
            LEFT JOIN pharmacy_stock s
                   ON s.hospital_id = h.id AND s.medicine_id = m.id AND s.deleted_at IS NULL
           WHERE h.deleted_at IS NULL
             AND h.is_live
             AND (%(hospital)s::uuid IS NULL OR h.id = %(hospital)s::uuid)
             AND EXISTS (SELECT 1 FROM pharmacy_stock ps WHERE ps.hospital_id = h.id AND ps.deleted_at IS NULL)
             AND fn_module_on(h.id, 'pharmacy')
             AND fn_publishes(h.id, 'stock')
        )
        SELECT hospital_id, name_bn, name_en, medicine_id, generic_name, brand_name, form,
               in_stock, updated_at, distance_m
          FROM (
            SELECT answers.*,
                   ROW_NUMBER() OVER (
                     PARTITION BY medicine_id
                     ORDER BY distance_m NULLS LAST, updated_at DESC NULLS LAST, name_en
                   ) AS rank
              FROM answers
          ) ranked
         WHERE rank <= %(limit)s
         ORDER BY generic_name, distance_m NULLS LAST, name_en
        """,
        {
            "pattern": pattern,
            "lat": lat,
            "lat0": lat if lat is not None else 0,
            "lng0": lng if lng is not None else 0,
            "hospital": hospital_id,
            "limit": limit,
        },
    )
    return [
        {
            "hospitalId": r["hospital_id"],
            "hospitalNameBn": r["name_bn"],
            "hospitalNameEn": r["name_en"],
            "medicineId": r["medicine_id"],
            "genericName": r["generic_name"],
            "brandName": r["brand_name"],
            "form": r["form"],
            "inStock": r["in_stock"],
            "updatedAt": _iso(r["updated_at"]),
            "distanceKm": None if r["distance_m"] is None else math.floor(r["distance_m"] / 100 + 0.5) / 10,
        }
        for r in rows
    ]
