"""Medicine stock, as the pharmacy keeps it and as a patient searches it (port of
`services/pharmacy.service.ts`; FR-PHA-*, PRD §3.2).

A yes older than twelve hours is published as "unknown", never as a stale
"in stock".
"""

from __future__ import annotations

from typing import Any

from ..core import db
from ..core.errors import forbidden_scope
from ..domain.lab import rank_stock_results, stock_answer_for, summarise_stock_search
from ..domain.time import from_datetime, now_iso, utc_now
from ..repositories import lab as lab_repo
from . import discovery


def shelf(hospital_id: str, actor: dict[str, str]) -> dict[str, Any]:
    if hospital_id != actor["hospitalId"]:
        raise forbidden_scope({"resource": "pharmacy stock", "hospitalId": hospital_id})
    now = now_iso()
    rows = lab_repo.list_stock(hospital_id)
    return {
        "rows": [
            {
                **row,
                "publishedAs": stock_answer_for({"inStock": row["inStock"], "updatedAt": row["updatedAt"]}, now)["answer"],
            }
            for row in rows
        ],
        "serverTs": now,
    }


def set_flags(*, hospital_id: str, flags: list[dict[str, Any]], actor: dict[str, str]) -> dict[str, Any]:
    if hospital_id != actor["hospitalId"]:
        raise forbidden_scope({"resource": "pharmacy stock", "hospitalId": hospital_id})
    at = utc_now()
    with db.transaction():
        written = lab_repo.upsert_stock_flags(
            hospital_id=hospital_id, flags=flags, at=at, staff_user_id=actor["staffUserId"]
        )
    after = shelf(hospital_id, actor)
    return {"rows": after["rows"], "written": written, "serverTs": from_datetime(at)}


def search_medicines(*, scope: str | None, q: str, lat: float | None, lng: float | None, limit: int) -> dict[str, Any]:
    now = now_iso()
    hospital_id = None if scope is None else discovery.scope_info(scope)["hospitalId"]
    rows = lab_repo.search_medicine_availability(hospital_id=hospital_id, query=q, lat=lat, lng=lng, limit=limit)
    by_medicine: dict[str, dict[str, Any]] = {}
    for row in rows:
        stocked = stock_answer_for(
            None
            if row["inStock"] is None or row["updatedAt"] is None
            else {"inStock": row["inStock"], "updatedAt": row["updatedAt"]},
            now,
        )
        pharmacy = {
            "hospitalId": row["hospitalId"],
            "hospitalNameBn": row["hospitalNameBn"],
            "hospitalNameEn": row["hospitalNameEn"],
            "distanceKm": row["distanceKm"],
            "answer": stocked["answer"],
            "freshness": stocked["freshness"],
        }
        existing = by_medicine.get(row["medicineId"])
        if existing is None:
            by_medicine[row["medicineId"]] = {
                "medicineId": row["medicineId"],
                "genericName": row["genericName"],
                "brandName": row["brandName"],
                "form": row["form"],
                "pharmacies": [pharmacy],
                "summary": {"inStock": 0, "outOfStock": 0, "unknown": 0},
            }
        else:
            existing["pharmacies"] = [*existing["pharmacies"], pharmacy]
    medicines = [
        {
            **entry,
            "pharmacies": rank_stock_results(entry["pharmacies"]),
            "summary": summarise_stock_search(entry["pharmacies"]),
        }
        for entry in by_medicine.values()
    ][:limit]
    return {"medicines": medicines, "serverTs": now}
