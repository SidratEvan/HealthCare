"""Offline sync controllers (port of `controllers/sync.controller.ts`; SY-01, FR-OFF-01, FR-REC-32)."""

from __future__ import annotations

from typing import Any

from ..core.errors import forbidden_scope
from ..core.http import ApiRequest, Reply, ok
from ..services import queue as queue_service
from ..services import sync as sync_service
from ..services.desk_access import assert_desk_allows
from .queue import actor_of


def push_events(req: ApiRequest) -> Reply:
    body = req.body
    session = _session_of(body["sessionId"])
    roles = _require_staff_scope(req, session["hospitalId"])
    _assert_desk_of(req, session)
    result = sync_service.push_batch(
        session_id=body["sessionId"],
        actor=actor_of(req),
        roles=roles,
        entries=[
            {
                "clientEventId": entry["clientEventId"],
                "type": entry["type"],
                "payload": entry["payload"],
                "clientTs": entry["clientTs"],
            }
            for entry in body["events"]
        ],
    )
    return ok(result)


def pull_session(req: ApiRequest) -> Reply:
    session_id = req.params["id"]
    query = req.query
    session = _session_of(session_id)
    _require_staff_scope(req, session["hospitalId"])
    _assert_desk_of(req, session)
    return ok(
        sync_service.pull_since(
            session_id=session_id, since_seq=query["sinceSeq"], last_synced_at=query.get("lastSyncedAt")
        )
    )


def _session_of(session_id: str) -> dict[str, Any]:
    session = queue_service.require_session(session_id)
    return {"hospitalId": session["hospitalId"], "doctorId": session["doctorId"]}


def _assert_desk_of(req: ApiRequest, session: dict[str, Any]) -> None:
    if req.principal is not None:
        assert_desk_allows(req.principal, session)


def _require_staff_scope(req: ApiRequest, hospital_id: str) -> list[str]:
    principal = req.principal
    if principal is None or principal.kind != "staff":
        raise forbidden_scope({"reason": "sync_is_staff_only"})
    if principal.hospital_id != hospital_id:
        raise forbidden_scope({"reason": "wrong_hospital"})
    return list(principal.roles)
