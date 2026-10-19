"""The Django API in-process, against the test database the Node suite builds.

For the Node cases that replace a Node module with a spy (`docs/django-migration/spy-tests.md`):
the same request is sent through the whole Django pipeline with Django's test
client, and the same failure is injected into the Python module instead.

The database is `healthcare_django_api_test`, migrated and seeded, as the
limited `healthcare_api` role (`env/test.env`); build it first:

    DATABASE_URL_API_TEST=postgresql://healthcare:healthcare@localhost:5432/healthcare_django_api_test \\
      pnpm --filter @platform/database exec tsx tests/support/build-api-db.cli.ts

No test database is created here and nothing is torn down: as in the Node
suite, each test makes a session of its own, because `queue_events` is
append-only.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any, Iterator

import pytest


@pytest.fixture(scope="session")
def django_db_setup() -> None:
    """The database exists already (see the module docstring); none is created."""


@pytest.fixture(scope="session", autouse=True)
def _database(django_db_blocker: Any) -> Iterator[None]:
    """Open for the whole session: the outbox sender's thread outlives the test
    that woke it, and must not find the database shut between tests."""
    with django_db_blocker.unblock():
        yield
    from medlive.services import notification_sender

    notification_sender.stop_sender()


@pytest.fixture(autouse=True)
def _routes() -> None:
    from medlive.core import pipeline

    pipeline._routers()


@dataclass
class Answer:
    status: int
    body: Any


class Api:
    """Requests through the whole pipeline, as supertest sent them to Express."""

    def __init__(self) -> None:
        from django.test import Client

        self.client = Client()

    def call(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        body: Any = None,
        idempotency_key: str | None = None,
    ) -> Answer:
        headers: dict[str, str] = {}
        if token is not None:
            headers["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        if method.upper() not in ("GET", "HEAD"):
            headers["HTTP_IDEMPOTENCY_KEY"] = idempotency_key or str(uuid.uuid4())
        send = getattr(self.client, method.lower())
        response = (
            send(f"/api/v1{path}", **headers)
            if body is None
            else send(f"/api/v1{path}", data=json.dumps(body), content_type="application/json", **headers)
        )
        try:
            parsed = json.loads(response.content.decode("utf8")) if response.content else None
        except ValueError:
            parsed = response.content
        return Answer(response.status_code, parsed)


@pytest.fixture
def api() -> Api:
    return Api()


def staff_token(staff_id: str, hospital_id: str, roles: list[str]) -> str:
    from medlive.core.jwt import sign_token

    return sign_token("access", {"sub": staff_id, "kind": "staff", "hospitalId": hospital_id, "roles": roles})


def staff_id_for(hospital_id: str, role: str) -> str:
    from medlive.core import db

    found = db.fetch_value(
        """
        SELECT staff_user_id FROM staff_roles
         WHERE hospital_id = %s AND role = %s::staff_role AND deleted_at IS NULL
         ORDER BY created_at, staff_user_id LIMIT 1
        """,
        [hospital_id, role],
    )
    if found is None:
        raise RuntimeError(f"The seed should give every facility a {role}; none found.")
    return found


@dataclass
class QueueFixture:
    session_id: str
    hospital_id: str
    doctor_id: str
    department_id: str
    fee_poisha: int
    booking_ids: list[str]
    patient_ids: list[str]
    spare_patient_id: str
    receptionist_id: str
    doctor_staff_id: str


def create_queue_fixture(bookings: int = 4, chamber_offset: int = 0) -> QueueFixture:
    """A scheduled session of its own with `bookings` seeded patients on serials 1..n
    (port of `__tests__/support/queueFixture.ts` `createQueueFixture`)."""
    from medlive.core import db

    chamber = db.fetch_one(
        """
        SELECT dh.hospital_id, dh.doctor_id, dh.department_id, dh.fee_poisha
          FROM doctor_hospitals dh JOIN doctors d ON d.id = dh.doctor_id
         WHERE dh.deleted_at IS NULL AND dh.is_active
         ORDER BY d.bmdc_number LIMIT 1 OFFSET %s
        """,
        [chamber_offset],
    )
    if chamber is None:
        raise RuntimeError("No seeded chamber found. Has the test database been built and seeded?")
    session_id = db.fetch_value(
        """
        INSERT INTO sessions (hospital_id, doctor_id, department_id, room, session_date,
                              planned_start, planned_end, capacity, fee_poisha)
        VALUES (%s, %s, %s, 'TEST', (now() AT TIME ZONE 'Asia/Dhaka')::date,
                now() - interval '30 minutes', now() + interval '150 minutes', 40, %s)
        RETURNING id
        """,
        [chamber["hospital_id"], chamber["doctor_id"], chamber["department_id"], chamber["fee_poisha"]],
    )
    patients = db.fetch_all(
        "SELECT id FROM patients WHERE deleted_at IS NULL ORDER BY created_at, id LIMIT %s", [bookings + 1]
    )
    if len(patients) < bookings + 1:
        raise RuntimeError(f"Need {bookings + 1} seeded patients, found {len(patients)}.")
    patient_ids = [row["id"] for row in patients[:bookings]]
    booking_ids = [
        db.fetch_value(
            """
            INSERT INTO bookings (session_id, patient_id, serial_number, source, fee_poisha, intake)
            VALUES (%s, %s, %s, 'app', %s, '{"demo":true}'::jsonb) RETURNING id
            """,
            [session_id, patient_id, index + 1, chamber["fee_poisha"]],
        )
        for index, patient_id in enumerate(patient_ids)
    ]
    return QueueFixture(
        session_id=session_id,
        hospital_id=chamber["hospital_id"],
        doctor_id=chamber["doctor_id"],
        department_id=chamber["department_id"],
        fee_poisha=chamber["fee_poisha"],
        booking_ids=booking_ids,
        patient_ids=patient_ids,
        spare_patient_id=patients[bookings]["id"],
        receptionist_id=staff_id_for(chamber["hospital_id"], "receptionist"),
        doctor_staff_id=staff_id_for(chamber["hospital_id"], "doctor"),
    )


def entry_status(session_id: str, booking_id: str) -> str | None:
    from medlive.services import queue

    state = queue.get_state(session_id)
    return next((entry["status"] for entry in state["entries"] if entry["bookingId"] == booking_id), None)
