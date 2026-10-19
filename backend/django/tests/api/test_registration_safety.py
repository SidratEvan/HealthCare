"""Equivalent of the `registration.routes.test.ts` case that spies on a Node module
(`docs/django-migration/spy-tests.md`; FR-REC-20, DB-P7): a reused identity is
not shown when the lookup audit it needs cannot be written.
"""

from __future__ import annotations

import random
from typing import Any
from urllib.parse import quote

import pytest

from .conftest import Api, create_queue_fixture, staff_token


def _spoken_phone() -> dict[str, str]:
    """A number nobody else in the run uses, as the patient would say it."""
    tail = str(random.randint(10_000_000, 99_999_999))
    return {"typed": f"018 {tail}", "stored": f"+88018{tail}"}


def test_a_reused_identity_is_not_shown_when_its_required_audit_fails(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    from medlive.core import db
    from medlive.repositories import registration as registration_repo

    fixture = create_queue_fixture(3)
    token = staff_token(fixture.receptionist_id, fixture.hospital_id, ["receptionist"])
    phone = _spoken_phone()
    body = {"phone": phone["typed"], "fullName": "Audited receipt (Demo)", "ageYears": 27, "sex": "female"}

    first = api.call("POST", "/registration/patients", token=token, body=body)
    assert first.status == 200, first.body
    patient_id = first.body["data"]["patientId"]

    original = registration_repo.record_lookup

    def audit_failure(**kwargs: Any) -> Any:
        raise RuntimeError("synthetic audit failure")

    monkeypatch.setattr(registration_repo, "record_lookup", audit_failure)
    refused = api.call("POST", "/registration/patients", token=token, body=body)
    assert refused.status == 500
    assert "data" not in refused.body

    monkeypatch.setattr(registration_repo, "record_lookup", original)
    again = api.call("POST", "/registration/patients", token=token, body=body)
    assert again.body["data"]["patientId"] == patient_id
    audited = db.fetch_value(
        """
        SELECT count(*)::int FROM audit_log
         WHERE actor_staff_id = %s AND patient_id = %s AND meta->>'purpose' = 'registration_lookup'
        """,
        [fixture.receptionist_id, patient_id],
    )
    assert audited == 1
    found = api.call("GET", f"/registration/patients?phone={quote(phone['typed'])}", token=token)
    assert len(found.body["data"]["patients"]) == 1
