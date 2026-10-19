"""Equivalents of `labPharmacySafety.routes.test.ts` cases that spy on a Node module
(`docs/django-migration/spy-tests.md`; DB-P7, FR-LAB-03).

- the label read fails closed when its audit cannot be written, and a foreign
  hospital is refused without an audit row being attempted;
- a report refused for its bytes, its declared type or its size never reaches
  storage. Against Django the Node spy on `storage().put` was never called
  whatever the server did, so those cases passed without testing anything;
  here the Python storage adapter is the one watched.
"""

from __future__ import annotations

import base64
import uuid
from typing import Any

import pytest

from .conftest import Api, staff_id_for, staff_token

TINY_PDF_BASE64 = base64.b64encode(
    b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"
).decode("ascii")


def _hospital(name_en_prefix: str) -> str:
    from medlive.core import db

    found = db.fetch_value(
        "SELECT id FROM hospitals WHERE name_en LIKE %s AND deleted_at IS NULL LIMIT 1", [f"{name_en_prefix}%"]
    )
    if found is None:
        raise RuntimeError(f"The seed should hold {name_en_prefix} (FR-DEM-01).")
    return found


class Lab:
    def __init__(self, name_en_prefix: str) -> None:
        self.hospital_id = _hospital(name_en_prefix)
        self.lab_staff_id = staff_id_for(self.hospital_id, "lab")
        self.lab_token = staff_token(self.lab_staff_id, self.hospital_id, ["lab"])
        self.doctor_token = staff_token(staff_id_for(self.hospital_id, "doctor"), self.hospital_id, ["doctor"])


def _fresh_visit(hospital_id: str) -> str:
    """A consultation signed a moment ago, with a booking behind it (port of `freshVisit`)."""
    from medlive.core import db

    row = db.fetch_one(
        """
        SELECT b.id, b.patient_id, s.doctor_id FROM bookings b JOIN sessions s ON s.id = b.session_id
         WHERE s.hospital_id = %s AND b.patient_id IS NOT NULL AND b.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.booking_id = b.id)
         ORDER BY b.created_at DESC LIMIT 1
        """,
        [hospital_id],
    )
    if row is None:
        raise RuntimeError("The seed should hold a booking with no visit yet (FR-DEM-03).")
    db.execute(
        """
        INSERT INTO visits (booking_id, patient_id, hospital_id, doctor_id, diagnosis_text, signed_at, created_by)
        VALUES (%s, %s, %s, %s, 'পরীক্ষার জন্য', now(), %s)
        """,
        [row["id"], row["patient_id"], hospital_id, row["doctor_id"], staff_id_for(hospital_id, "doctor")],
    )
    return row["id"]


def _reportable(api: Api, lab: Lab) -> str:
    booking_id = _fresh_visit(lab.hospital_id)
    key = str(uuid.uuid4())
    ordered = api.call(
        "POST",
        "/test-orders",
        token=lab.doctor_token,
        idempotency_key=key,
        body={"bookingId": booking_id, "tests": [{"testCode": "CBC"}], "idempotencyKey": key},
    )
    assert ordered.status == 201, ordered.body
    order_id = ordered.body["data"]["orders"][0]["id"]
    for action in ("collect", "process"):
        action_key = str(uuid.uuid4())
        stepped = api.call(
            "PATCH",
            f"/test-orders/{order_id}/state",
            token=lab.lab_token,
            idempotency_key=action_key,
            body={"action": action, "idempotencyKey": action_key},
        )
        assert stepped.status == 200, stepped.body
    return order_id


def _upload(api: Api, lab: Lab, order_id: str, content: str, file_type: str = "application/pdf") -> Any:
    key = str(uuid.uuid4())
    return api.call(
        "POST",
        f"/test-orders/{order_id}/report",
        token=lab.lab_token,
        idempotency_key=key,
        body={"content": content, "fileType": file_type, "idempotencyKey": key},
    )


def _patient_of(order_id: str) -> str:
    from medlive.repositories import lab as lab_repo

    order = lab_repo.find_test_order(order_id)
    assert order is not None
    return order["patientId"]


@pytest.fixture
def lab() -> Lab:
    return Lab("Shapla General")


@pytest.fixture
def puts(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Every key the storage adapter is asked to store, while still storing it."""
    from medlive.adapters import storage

    seen: list[str] = []
    adapter = storage.storage()
    original = adapter.put

    def watched(**kwargs: Any) -> Any:
        seen.append(kwargs.get("key", ""))
        return original(**kwargs)

    monkeypatch.setattr(adapter, "put", watched)
    return seen


def test_the_label_read_fails_closed_when_its_audit_cannot_be_written(
    api: Api, lab: Lab, monkeypatch: pytest.MonkeyPatch
) -> None:
    from medlive.repositories import clinical

    order_id = _reportable(api, lab)
    original = clinical.record_record_view
    calls = {"n": 0}

    def audit_failure(**kwargs: Any) -> Any:
        if calls["n"] == 0:
            calls["n"] += 1
            raise RuntimeError("synthetic audit failure")
        return original(**kwargs)

    monkeypatch.setattr(clinical, "record_record_view", audit_failure)
    answer = api.call("GET", f"/test-orders/{order_id}/patient", token=lab.lab_token)

    assert answer.status == 500
    assert "data" not in answer.body
    assert _patient_of(order_id) not in str(answer.body)


def test_a_foreign_hospital_is_refused_without_an_audit_being_attempted(
    api: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    from medlive.repositories import clinical

    foreign = Lab("Padma Specialised")
    order_id = _reportable(api, foreign)
    own = Lab("Shapla General")
    attempted: list[Any] = []
    original = clinical.record_record_view

    def watched(**kwargs: Any) -> Any:
        attempted.append(kwargs)
        return original(**kwargs)

    monkeypatch.setattr(clinical, "record_record_view", watched)
    answer = api.call("GET", f"/test-orders/{order_id}/patient", token=own.lab_token)

    assert answer.status == 404
    assert attempted == []


@pytest.mark.parametrize(
    ("name", "content"),
    [
        ("invalid characters", TINY_PDF_BASE64 + "!"),
        ("missing padding", "JVBERi0"),
        ("empty decoded payload", "===="),
        ("wrong signature", base64.b64encode(b"<html>synthetic</html>").decode("ascii")),
        ("noncanonical padding", "JVBERi1="),
    ],
)
def test_a_report_refused_for_its_bytes_never_reaches_storage(
    api: Api, lab: Lab, puts: list[str], name: str, content: str
) -> None:
    from medlive.core import db

    order_id = _reportable(api, lab)
    answer = _upload(api, lab, order_id, content)

    assert answer.status == 400, name
    assert puts == []
    assert db.fetch_value("SELECT count(*)::int FROM reports WHERE test_order_id = %s AND deleted_at IS NULL", [order_id]) == 0
    assert db.fetch_value("SELECT state::text FROM test_orders WHERE id = %s", [order_id]) == "processing"


def test_a_declared_type_that_is_not_the_file_never_reaches_storage(api: Api, lab: Lab, puts: list[str]) -> None:
    order_id = _reportable(api, lab)
    assert _upload(api, lab, order_id, TINY_PDF_BASE64, "image/png").status == 400
    assert puts == []


def test_one_byte_over_ten_mebibytes_never_reaches_storage(api: Api, lab: Lab, puts: list[str]) -> None:
    from medlive.domain.schemas.lab import REPORT_MAX_BYTES

    exact = bytearray(b" " * REPORT_MAX_BYTES)
    exact[: len(b"%PDF-1.4\n")] = b"%PDF-1.4\n"
    first = _reportable(api, lab)
    assert _upload(api, lab, first, base64.b64encode(bytes(exact)).decode("ascii")).status == 201
    puts.clear()
    other = _reportable(api, lab)
    over = base64.b64encode(bytes(exact) + b" ").decode("ascii")
    assert _upload(api, lab, other, over).status == 400
    assert puts == []
