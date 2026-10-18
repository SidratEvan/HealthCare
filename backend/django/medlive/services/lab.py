"""Test orders and their reports (port of `services/lab.service.ts`; FR-LAB-01..08, S-B-08).

An order moves one step at a time (`domain/lab.py`). A report is checked by
its bytes before it is stored, and on upload goes straight to the patient's
wallet: ready, delivered, and one message saying so.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import math
import re
from datetime import timedelta
from typing import Any
from urllib.parse import unquote

from ..adapters.storage import storage, verify_file_signature
from ..core import db
from ..core.errors import AppError, forbidden_scope, not_found, validation_failed
from ..core.links import patient_link
from ..core.logging import logger
from ..domain.documents import sniff_document
from ..domain.lab import (
    LAB_ACTION_RESULT,
    OPEN_TEST_STATES,
    REPORTED_TEST_STATES,
    can_act_on_test_order,
    can_deliver_report,
    can_upload_report,
    lab_order_already_applied,
    sort_lab_queue,
    summarise_turnaround,
)
from ..domain.schemas.lab import REPORT_MAX_BYTES
from ..domain.time import from_datetime, now_iso, now_ms, utc_now
from ..i18n import LAB_TEST_NAMES, is_lab_test_code
from ..realtime import emit
from ..repositories import clinical as clinical_repo
from ..repositories import lab as lab_repo
from . import notification as notifications
from . import portal as portals

#: Demonstration prices (FR-DEM-*): what the seeded catalogue charges.
DEMO_TEST_PRICES: dict[str, int] = {
    "CBC": 45_000,
    "BLOOD-SUGAR": 20_000,
    "LIPID-PROFILE": 90_000,
    "SERUM-CREATININE": 50_000,
    "LFT": 120_000,
    "TSH": 80_000,
    "URINE-RE": 25_000,
    "XR-CHEST": 60_000,
    "ECG": 40_000,
    "ECHO": 250_000,
    "USG-ABDOMEN": 150_000,
    "HBA1C": 110_000,
}


def test_catalogue() -> list[dict[str, Any]]:
    return [
        {
            "code": code,
            "nameBn": LAB_TEST_NAMES[code]["bn"],
            "nameEn": LAB_TEST_NAMES[code]["en"],
            "pricePoisha": price,
        }
        for code, price in DEMO_TEST_PRICES.items()
    ]


def _guard(result: dict[str, Any]) -> None:
    if result["ok"]:
        return
    raise AppError(
        "TEST_TRANSITION_INVALID",
        message=result.get("detail") or "That step is not allowed.",
        details={"guard": result.get("code") or "WRONG_STATE"},
    )


def order(*, booking_id: str, tests: list[dict[str, Any]], idempotency_key: str, actor: dict[str, str]) -> dict[str, Any]:
    with db.transaction():
        lab_repo.lock_idempotency_key(idempotency_key)
        replayed = lab_repo.find_by_idempotency_key(idempotency_key)
        if replayed:
            orders, duplicate, hospital_id = replayed, True, replayed[0]["hospitalId"]
        else:
            visit = lab_repo.visit_for_booking(booking_id)
            if visit is None:
                raise not_found("visit")
            if visit["hospitalId"] != actor["hospitalId"]:
                raise forbidden_scope({"resource": "visit", "hospitalId": visit["hospitalId"]})
            created: list[str] = []
            seen: set[str] = set()
            for test in tests:
                code = test["testCode"].upper()
                if code in seen:
                    continue
                seen.add(code)
                known = code if is_lab_test_code(code) else None
                test_name = test.get("testName") if known is None else LAB_TEST_NAMES[known]["bn"]
                if test_name is None:
                    raise validation_failed(
                        {"field": "tests", "reason": f"unknown test code {code}, and no name was given for it"}
                    )
                created.append(
                    lab_repo.insert_test_order(
                        visit_id=visit["visitId"],
                        patient_id=visit["patientId"],
                        hospital_id=visit["hospitalId"],
                        test_code=code,
                        test_name=test_name,
                        price_poisha=0 if known is None else DEMO_TEST_PRICES[known],
                        ordered_by=actor["staffUserId"],
                        idempotency_key=f"{idempotency_key}:{code}",
                    )
                )
            orders = [row for row in (lab_repo.find_test_order(i) for i in created) if row is not None]
            duplicate, hospital_id = False, visit["hospitalId"]
    server_ts = now_iso()
    if not duplicate and orders and hospital_id is not None:
        emit.test_ordered(hospital_id, {"orders": orders}, server_ts)
    return {"orders": orders, "duplicate": duplicate, "serverTs": server_ts}


def advance(*, order_id: str, action: str, actor: dict[str, str]) -> dict[str, Any]:
    at = utc_now()
    with db.transaction():
        current = _lock_own(order_id, actor)
        if lab_order_already_applied(current, action):
            updated, duplicate = current, True
        else:
            _guard(can_act_on_test_order(current, action))
            lab_repo.set_test_order_state(order_id=current["id"], state=LAB_ACTION_RESULT[action], at=at)
            after = lab_repo.find_test_order(current["id"])
            if after is None:
                raise not_found("test order")
            updated, duplicate = after, False
    server_ts = from_datetime(at)
    if not duplicate:
        emit.test_updated(updated["hospitalId"], {"order": updated}, server_ts)
    return {"order": updated, "duplicate": duplicate, "serverTs": server_ts}


_BASE64 = re.compile(r"^[A-Za-z0-9+/]*={0,2}\Z")


def upload_report(
    *, order_id: str, file_type: str, content: str, idempotency_key: str, actor: dict[str, str]
) -> dict[str, Any]:
    at = utc_now()
    before = lab_repo.find_test_order(order_id)
    if before is None:
        raise not_found("test order")
    if before["hospitalId"] != actor["hospitalId"]:
        raise forbidden_scope({"resource": "test order", "hospitalId": before["hospitalId"]})
    already = lab_repo.find_report_by_idempotency_key(idempotency_key)
    if already is not None:
        _assert_report_owner(already["testOrderId"], before["id"])
        return {"order": before, "duplicate": True, "serverTs": from_datetime(at)}
    _guard(can_upload_report(before))
    if len(content) > math.ceil(REPORT_MAX_BYTES / 3) * 4 or len(content) % 4 != 0 or not _BASE64.match(content):
        raise validation_failed({"field": "content", "reason": "invalid or oversized base64"})
    try:
        data = base64.b64decode(content, validate=True)
    except (binascii.Error, ValueError):
        data = b""
    if (
        len(data) == 0
        or len(data) > REPORT_MAX_BYTES
        or base64.b64encode(data).decode("ascii") != content
        or sniff_document(data) != file_type
    ):
        raise validation_failed({"field": "content", "reason": "unsupported, mismatched or oversized file"})
    digest = hashlib.sha256(data).hexdigest()
    key = f"reports/{before['id']}/{idempotency_key}-{digest}.{_extension_for(file_type)}"
    try:
        stored = storage().put(key=key, content_type=file_type, data=data)
        file_url = stored["url"]
    except Exception as cause:
        logger.error({"orderId": before["id"], "err": cause}, "report upload failed")
        raise AppError("REPORT_STORAGE_FAILED", cause=cause) from cause
    records_link = patient_link("/records", {}, hospital_origin=portals.hospital_link_origin(before["hospitalId"]))
    batch: dict[str, Any] | None = None
    with db.transaction():
        lab_repo.lock_idempotency_key(idempotency_key)
        current = _lock_own(order_id, actor)
        replayed = lab_repo.find_report_by_idempotency_key(idempotency_key)
        if replayed is not None:
            _assert_report_owner(replayed["testOrderId"], current["id"])
            updated, duplicate = current, True
        else:
            _guard(can_upload_report(current))
            report_id = lab_repo.insert_report(
                test_order_id=current["id"],
                file_url=file_url,
                file_type=file_type,
                uploaded_by=actor["staffUserId"],
                idempotency_key=idempotency_key,
            )
            if current["state"] != "report_ready":
                lab_repo.set_test_order_state(order_id=current["id"], state="report_ready", at=at)
            recipients = ["patient"] if current["visitId"] is None else ["patient", "doctor"]
            with_report = lab_repo.find_test_order(current["id"])
            if with_report is None:
                raise not_found("test order")
            _guard(can_deliver_report(with_report))
            lab_repo.mark_report_delivered(report_id=report_id, recipients=recipients, at=at)
            lab_repo.set_test_order_state(order_id=current["id"], state="delivered", at=at)
            batch = notifications.queue_report_ready(test_order_id=current["id"], link=records_link, at=at)
            after = lab_repo.find_test_order(current["id"])
            if after is None:
                raise not_found("test order")
            updated, duplicate = after, False
    server_ts = from_datetime(at)
    if not duplicate:
        emit.test_updated(updated["hospitalId"], {"order": updated}, server_ts)
        if batch is not None:
            notifications.dispatch(batch)
    return {"order": updated, "duplicate": duplicate, "serverTs": server_ts}


def _assert_report_owner(test_order_id: str, order_id: str) -> None:
    if test_order_id != order_id:
        raise AppError("IDEMPOTENCY_KEY_REUSED")


def _extension_for(file_type: str) -> str:
    return {"application/pdf": "pdf", "image/png": "png", "image/webp": "webp"}.get(file_type, "jpg")


_STATE_SETS: dict[str, list[str]] = {
    "open": list(OPEN_TEST_STATES),
    "reported": list(REPORTED_TEST_STATES),
    "all": [*OPEN_TEST_STATES, *REPORTED_TEST_STATES, "cancelled"],
}


def queue(*, hospital_id: str, state: str, days: int, actor: dict[str, str]) -> dict[str, Any]:
    if hospital_id != actor["hospitalId"]:
        raise forbidden_scope({"resource": "lab queue", "hospitalId": hospital_id})
    since = utc_now() - timedelta(days=days)
    rows = lab_repo.list_lab_queue(hospital_id=hospital_id, states=_STATE_SETS[state], since=since)
    every = rows if state == "all" else lab_repo.list_lab_queue(hospital_id=hospital_id, states=_STATE_SETS["all"], since=since)
    return {
        "orders": sort_lab_queue(rows),
        "turnaround": summarise_turnaround(every, now_ms()),
        "serverTs": now_iso(),
    }


def orders_for_booking(booking_id: str) -> list[dict[str, Any]]:
    return sort_lab_queue(lab_repo.list_test_orders_for_booking(booking_id))


def patient_label(order_id: str, actor: dict[str, str]) -> str | None:
    row = lab_repo.find_test_order(order_id)
    if row is None:
        raise not_found("test order")
    if row["hospitalId"] != actor["hospitalId"]:
        raise forbidden_scope({"resource": "test order", "hospitalId": row["hospitalId"]})
    label = lab_repo.patient_label(row["patientId"])
    clinical_repo.record_record_view(
        staff_user_id=actor["staffUserId"],
        user_id=None,
        hospital_id=actor["hospitalId"],
        patient_id=row["patientId"],
        subject_table="test_orders",
        subject_id=row["id"],
        meta={"surface": "S-B-08", "read": "patient_label"},
    )
    return label


def open_signed_file(*, key: str, expires: float, signature: str) -> dict[str, Any] | None:
    if not verify_file_signature(key, expires, signature)["ok"]:
        return None
    return storage().get(key)


def report_url(report_id: str) -> str | None:
    file = lab_repo.find_report_file(report_id)
    if file is None:
        return None
    return storage().signed_url(_key_from_url(file["fileUrl"]))


def _key_from_url(file_url: str) -> str:
    path = file_url.split("?")[0]
    marker = "/files/"
    at = path.find(marker)
    return path if at == -1 else unquote(path[at + len(marker) :])


def _lock_own(order_id: str, actor: dict[str, str]) -> dict[str, Any]:
    current = lab_repo.lock_test_order(order_id)
    if current is None:
        raise not_found("test order")
    if current["hospitalId"] != actor["hospitalId"]:
        raise forbidden_scope({"resource": "test order", "hospitalId": current["hospitalId"]})
    return current
