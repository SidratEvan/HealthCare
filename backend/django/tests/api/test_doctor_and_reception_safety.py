"""The Node cases that spy on a Node module, run against Django with the failure
injected into the Python module instead (`docs/django-migration/spy-tests.md`).

- `doctorSafety.routes.test.ts` (FR-DOC-08, FR-DOC-10, FR-QUE-53): reception's
  Next landing before the doctor's lock, between the signature and its queue
  step, and a queue step that fails after the signature committed.
- `receptionSafety.routes.test.ts` (FR-QUE-51, FR-REC-14): an event write that
  fails rolls back the walk-in's booking too.

Reception's step "on another device" runs in a second thread: Django's
connections are per thread, so it commits on its own connection, as the Node
test's call did on another pooled one.
"""

from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

import pytest

from .conftest import Api, QueueFixture, create_queue_fixture, entry_status, staff_token


def _on_another_connection(work: Callable[[], Any]) -> Any:
    """Runs `work` in a thread of its own, so it commits on its own connection."""
    outcome: dict[str, Any] = {}

    def run() -> None:
        from django.db import connection

        try:
            outcome["value"] = work()
        except BaseException as error:  # noqa: BLE001 - re-raised in the caller
            outcome["error"] = error
        finally:
            connection.close()

    thread = threading.Thread(target=run)
    thread.start()
    thread.join(timeout=30)
    if "error" in outcome:
        raise outcome["error"]
    return outcome.get("value")


def _reception(fixture: QueueFixture) -> dict[str, str]:
    return {"kind": "staff", "staffUserId": fixture.receptionist_id, "role": "receptionist"}


def _next(fixture: QueueFixture) -> Any:
    from medlive.services import queue

    return queue.call_next(session_id=fixture.session_id, actor=_reception(fixture), client_event_id=str(uuid.uuid4()))


@pytest.fixture
def chamber() -> tuple[QueueFixture, str]:
    """Four patients, the doctor arrived, the first one called in (as the Node `beforeEach`)."""
    from medlive.services import queue

    fixture = create_queue_fixture(4)
    token = staff_token(fixture.doctor_staff_id, fixture.hospital_id, ["doctor"])
    queue.append_event(
        {
            "sessionId": fixture.session_id,
            "type": "DOCTOR_ARRIVED",
            "payload": {"arrivedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"), "minutesLate": 0},
            "actor": _reception(fixture),
            "clientEventId": str(uuid.uuid4()),
        }
    )
    _next(fixture)
    return fixture, token


def _sign(api: Api, fixture: QueueFixture, token: str, **body: Any) -> Any:
    key = str(uuid.uuid4())
    return api.call(
        "POST",
        "/visits",
        token=token,
        idempotency_key=key,
        body={
            "bookingId": fixture.booking_ids[0],
            "diagnosisText": "Synthetic safety note",
            "expectedRevision": None,
            **body,
            "idempotencyKey": key,
        },
    )


def _visit_of(booking_id: str) -> Any:
    from medlive.repositories import clinical

    return clinical.find_visit_by_booking(booking_id)


def test_a_stale_unsigned_sign_is_refused_when_reception_wins_before_the_lock(
    api: Api, chamber: tuple[QueueFixture, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from medlive.repositories import session as session_repo

    fixture, token = chamber
    original = session_repo.lock_for_update
    calls = {"n": 0}

    def reception_first(session_id: str) -> Any:
        if calls["n"] == 0:
            calls["n"] += 1
            _on_another_connection(lambda: _next(fixture))
        return original(session_id)

    monkeypatch.setattr(session_repo, "lock_for_update", reception_first)
    answer = _sign(api, fixture, token, sign=True)

    assert answer.status == 422
    assert answer.body["error"]["details"]["guard"] == "PATIENT_NOT_IN_CHAMBER"
    assert _visit_of(fixture.booking_ids[0]) is None
    assert entry_status(fixture.session_id, fixture.booking_ids[1]) == "in_chamber"


def test_b_is_not_finished_when_reception_advances_between_the_signature_and_its_queue_step(
    api: Api, chamber: tuple[QueueFixture, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from medlive.repositories import clinical
    from medlive.services import queue

    fixture, token = chamber
    original = queue.call_next
    calls = {"n": 0}

    def reception_first(**kwargs: Any) -> Any:
        if calls["n"] == 0:
            calls["n"] += 1
            original(session_id=fixture.session_id, actor=_reception(fixture), client_event_id=str(uuid.uuid4()))
        return original(**kwargs)

    monkeypatch.setattr(queue, "call_next", reception_first)
    answer = _sign(api, fixture, token, sign=True)

    assert answer.status == 201
    assert answer.body["data"]["signed"] is True
    assert entry_status(fixture.session_id, fixture.booking_ids[1]) == "in_chamber"
    assert answer.body["data"]["queueOutcome"] == "changed"
    signed = clinical.find_visit_for_booking(fixture.booking_ids[0])
    assert signed is not None and signed["signedAt"] is not None
    assert _visit_of(fixture.booking_ids[1]) is None


def test_a_committed_signature_is_reported_apart_from_a_failed_queue_step_and_recovers(
    api: Api, chamber: tuple[QueueFixture, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from medlive.repositories import clinical
    from medlive.services import queue

    fixture, token = chamber
    original = queue.call_next
    calls = {"n": 0}

    def outage_once(**kwargs: Any) -> Any:
        if calls["n"] == 0:
            calls["n"] += 1
            raise RuntimeError("Synthetic queue outage")
        return original(**kwargs)

    monkeypatch.setattr(queue, "call_next", outage_once)
    signed = _sign(api, fixture, token, sign=True)

    assert signed.status == 201
    assert signed.body["data"]["signed"] is True
    assert signed.body["data"]["queue"] is None
    assert signed.body["data"]["queueOutcome"] == "retry_needed"
    visit = clinical.find_visit_for_booking(fixture.booking_ids[0])
    assert visit is not None and visit["signedAt"] is not None
    assert entry_status(fixture.session_id, fixture.booking_ids[0]) == "in_chamber"

    recovery = _sign(api, fixture, token, sign=True)
    assert recovery.status == 201
    assert entry_status(fixture.session_id, fixture.booking_ids[1]) == "in_chamber"


def test_an_event_write_failure_rolls_back_the_walk_in_booking_too(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    from medlive.core import db
    from medlive.repositories import queue_event

    fixture = create_queue_fixture(0)
    token = staff_token(fixture.receptionist_id, fixture.hospital_id, ["receptionist"])
    original = queue_event.append
    calls = {"n": 0}

    def fail_once(draft: dict[str, Any]) -> Any:
        if calls["n"] == 0:
            calls["n"] += 1
            raise RuntimeError("synthetic event failure")
        return original(draft)

    monkeypatch.setattr(queue_event, "append", fail_once)
    answer = api.call(
        "POST",
        f"/sessions/{fixture.session_id}/walkin",
        token=token,
        body={
            "patientId": fixture.spare_patient_id,
            "position": "end",
            "index": None,
            "reason": None,
            "clientEventId": str(uuid.uuid4()),
            "clientTs": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        },
    )

    assert answer.status == 500
    count = db.fetch_value("SELECT count(*)::int FROM bookings WHERE session_id = %s", [fixture.session_id])
    assert count == 0
