"""Equivalents of Node cases that watch the Node process from inside
(`docs/django-migration/spy-tests.md`):

- `broadcastAfterCommit.test.ts` installs its own emitter in the Node process,
  which Django never calls. Here a witness emitter is installed in the Django
  process: at the moment of each broadcast it reads the chamber's event log
  on a connection of its own, which sees only what is committed (FR-QUE-10,
  SY-08).
- `adminChambers.routes.test.ts` counts the Node driver's executions for the
  admin's chamber board. Here Django's own query capture counts the SQL the
  Python repository runs (FR-ADM-12).
"""

from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone
from typing import Any

import pytest

from .conftest import Api, create_queue_fixture, staff_token


def _event_types(session_id: str) -> list[str]:
    from medlive.core import db

    return [row["type"] for row in db.fetch_all("SELECT type FROM queue_events WHERE session_id = %s ORDER BY seq", [session_id])]


def _committed_log(session_id: str) -> list[str]:
    """What another connection can read now: only what is committed."""
    found: dict[str, Any] = {}

    def read() -> None:
        from django.db import connection

        try:
            found["log"] = _event_types(session_id)
        finally:
            connection.close()

    thread = threading.Thread(target=read)
    thread.start()
    thread.join(timeout=30)
    return found.get("log", [])


class WitnessEmitter:
    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.told: list[dict[str, Any]] = []

    def emit(self, room: str, event: str, envelope: dict[str, Any]) -> None:
        entry: dict[str, Any] = {"room": room, "event": event}
        if event == "queue.updated" and room.startswith(f"session:{self.session_id}"):
            entry["committedLog"] = _committed_log(self.session_id)
        self.told.append(entry)


@pytest.fixture
def witnessed() -> Any:
    from medlive.realtime import emit

    fixture = create_queue_fixture(4)
    witness = WitnessEmitter(fixture.session_id)
    previous = emit.emitter()
    emit.set_emitter(witness)
    try:
        yield fixture, witness
    finally:
        emit.set_emitter(previous)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def test_the_room_is_told_after_the_write_is_committed_for_every_way_a_counter_writes(api: Api, witnessed: Any) -> None:
    fixture, witness = witnessed
    token = staff_token(fixture.receptionist_id, fixture.hospital_id, ["receptionist"])
    calls: list[tuple[str, dict[str, Any]]] = [
        (f"/sessions/{fixture.session_id}/arrived", {}),
        (f"/sessions/{fixture.session_id}/next", {}),
        (f"/sessions/{fixture.session_id}/delay", {"minutes": 15, "reason": None, "declaredBy": "reception"}),
        (
            "/sync/events",
            {
                "sessionId": fixture.session_id,
                "events": [
                    {"clientEventId": str(uuid.uuid4()), "type": "SESSION_PAUSED", "payload": {"reason": None}, "clientTs": _now()}
                ],
            },
        ),
    ]
    for path, body in calls:
        before = len(witness.told)
        answer = api.call("POST", path, token=token, body={"clientEventId": str(uuid.uuid4()), **body} if path != "/sync/events" else body)
        assert answer.status == 200, path
        updates = [entry for entry in witness.told[before:] if entry["event"] == "queue.updated"]
        assert updates, f"{path} told nobody"
        assert updates[0]["committedLog"] == _event_types(fixture.session_id), f"{path} was broadcast before it was committed"


def test_nobody_is_told_of_a_write_that_fails_after_it_was_computed(
    api: Api, witnessed: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    from medlive.repositories import notification as notification_repo

    fixture, witness = witnessed
    token = staff_token(fixture.receptionist_id, fixture.hospital_id, ["receptionist"])
    assert api.call("POST", f"/sessions/{fixture.session_id}/arrived", token=token, body={"clientEventId": str(uuid.uuid4())}).status == 200
    before = len(witness.told)
    log_before = _event_types(fixture.session_id)

    original = notification_repo.queue_all
    calls = {"n": 0}

    def disk_full(notifications: list[dict[str, Any]]) -> Any:
        if calls["n"] == 0:
            calls["n"] += 1
            raise RuntimeError("disk full")
        return original(notifications)

    monkeypatch.setattr(notification_repo, "queue_all", disk_full)
    answer = api.call("POST", f"/sessions/{fixture.session_id}/next", token=token, body={"clientEventId": str(uuid.uuid4())})

    assert answer.status == 500
    assert _event_types(fixture.session_id) == log_before
    assert witness.told[before:] == []


def test_the_chamber_board_is_one_sql_execution_for_hundreds_of_chambers() -> None:
    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    from medlive.core import db
    from medlive.domain.time import now_iso, to_dhaka_date
    from medlive.repositories.admin_chambers import CHAMBER_LIMIT, chambers_today

    fixture = create_queue_fixture(1)
    inserted = db.fetch_all(
        """
        INSERT INTO sessions (hospital_id, doctor_id, department_id, room, session_date,
                              planned_start, planned_end, capacity, fee_poisha)
        SELECT hospital_id, doctor_id, department_id, 'TEST', session_date, planned_start, planned_end, capacity, fee_poisha
          FROM sessions CROSS JOIN generate_series(1, %s) WHERE id = %s
        RETURNING id
        """,
        [CHAMBER_LIMIT + 1, fixture.session_id],
    )
    try:
        with CaptureQueriesContext(connection) as captured:
            result = chambers_today(fixture.hospital_id, to_dhaka_date(now_iso()))
        # The scope statement `core/db.py` makes before a statement is not the
        # repository's SQL; Kysely's spy did not see Node's either.
        executed = [query for query in captured.captured_queries if "set_config" not in query["sql"]]
        assert len(executed) == 1
        assert len(result["chambers"]) == CHAMBER_LIMIT
        assert result["chambersTruncated"] is True
    finally:
        db.execute("UPDATE sessions SET deleted_at = now() WHERE id = ANY(%s::uuid[])", [[row["id"] for row in inserted]])
