"""Equivalents of the `staffAuth.routes.test.ts` refresh races that pause a Node
repository mid-transaction (`docs/django-migration/spy-tests.md`; FR-SEC-06, FR-DOC-08).

The rotation is paused after the old refresh row is revoked and before the new
one is written; the other request runs in a thread of its own, on its own
connection, as the Node test's ran on another pooled one.
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any, Callable

import pytest

from .conftest import Api, Answer

PASSWORD = "correct-horse-battery"


def _hospital(code: str) -> str:
    from medlive.core import db

    found = db.fetch_value("SELECT id FROM hospitals WHERE code = %s", [code])
    if found is None:
        raise RuntimeError(f"No seeded facility with code {code} (FR-DEM-01).")
    return found


def _make_staff(roles: list[str]) -> str:
    """A fresh account for one test, at Shapla (port of `makeStaff`)."""
    from medlive.core import db
    from medlive.core.password import hash_password

    hospital_id = _hospital("SHAPLA")
    email = f"t-{uuid.uuid4().hex[:8]}@shapla.demo.invalid"
    staff_id = db.fetch_value(
        """
        INSERT INTO staff_users (hospital_id, email, full_name, password_hash, must_change_password, is_active)
        VALUES (%s, %s, 'পরীক্ষা (ডেমো)', %s, false, true) RETURNING id
        """,
        [hospital_id, email, hash_password(PASSWORD)],
    )
    for role in roles:
        db.execute(
            "INSERT INTO staff_roles (staff_user_id, hospital_id, role) VALUES (%s, %s, %s::staff_role)",
            [staff_id, hospital_id, role],
        )
    return email


def _login(api: Api, email: str) -> dict[str, Any]:
    answer = api.call("POST", "/staff/login", body={"email": email, "password": PASSWORD})
    assert answer.status == 200, answer.body
    return answer.body["data"]


def _in_thread(work: Callable[[], Answer]) -> tuple[threading.Thread, dict[str, Any]]:
    result: dict[str, Any] = {}

    def run() -> None:
        from django.db import connection

        try:
            result["answer"] = work()
        finally:
            connection.close()

    thread = threading.Thread(target=run)
    thread.start()
    return thread, result


def _wait_for_lock_wait() -> None:
    from medlive.core import db

    for _attempt in range(200):
        waiting = db.fetch_value(
            "SELECT count(*)::int FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE %s",
            ["%sessions_auth%"],
        )
        if (waiting or 0) > 0:
            return
        time.sleep(0.025)
    raise AssertionError("the second refresh never waited on the first")


def test_the_sign_in_stays_live_while_it_rotates(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    from medlive.repositories import staff_auth as staff_auth_repo

    email = _make_staff(["doctor"])
    first = _login(api, email)
    original = staff_auth_repo.create_refresh_session
    midway: dict[str, Any] = {}
    calls = {"n": 0}

    def paused(**kwargs: Any) -> Any:
        if calls["n"] == 0:
            calls["n"] += 1
            thread, result = _in_thread(lambda: Api().call("GET", "/staff/me", token=first["access"]))
            thread.join(timeout=30)
            midway.update(result)
        return original(**kwargs)

    monkeypatch.setattr(staff_auth_repo, "create_refresh_session", paused)
    renewed = api.call("POST", "/staff/refresh", body={"refresh": first["refresh"]})

    assert renewed.status == 200
    assert "answer" in midway
    assert midway["answer"].status == 200
    me = api.call("GET", "/staff/me", token=renewed.body["data"]["access"])
    assert me.status == 200


def test_racing_with_the_same_token_one_renews_the_other_is_refused_and_nobody_is_signed_out(
    api: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    from medlive.repositories import staff_auth as staff_auth_repo

    email = _make_staff(["doctor"])
    first = _login(api, email)
    original = staff_auth_repo.create_refresh_session
    second: dict[str, Any] = {}
    calls = {"n": 0}

    def renew() -> Answer:
        return Api().call("POST", "/staff/refresh", body={"refresh": first["refresh"]})

    def held(**kwargs: Any) -> Any:
        if calls["n"] == 0:
            calls["n"] += 1
            thread, result = _in_thread(renew)
            second["thread"], second["result"] = thread, result
            _wait_for_lock_wait()
        return original(**kwargs)

    monkeypatch.setattr(staff_auth_repo, "create_refresh_session", held)
    first_answer = renew()
    assert "thread" in second
    second["thread"].join(timeout=30)
    answers = [first_answer, second["result"]["answer"]]
    won = [answer for answer in answers if answer.status == 200]
    lost = [answer for answer in answers if answer.status != 200]

    assert len(won) == 1
    assert len(lost) == 1
    assert lost[0].status == 401
    assert lost[0].body["error"]["details"]["reason"] == "raced"
    # A race is not theft: the winner's tokens keep working.
    assert api.call("GET", "/staff/me", token=won[0].body["data"]["access"]).status == 200
    assert api.call("POST", "/staff/refresh", body={"refresh": won[0].body["data"]["refresh"]}).status == 200
