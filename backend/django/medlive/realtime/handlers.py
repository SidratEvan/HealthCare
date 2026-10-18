"""Subscribe, unsubscribe and resume-from-seq (port of `realtime/handlers.ts`; BACKEND.md §6).

A reconnecting client says the highest sequence it has folded; it is sent the
events after it, in order, and then the settled state (SY-01). A client that
sends none, or is far behind, gets the state. A phone is only ever sent the
patients' copy, never an event: an event names the booking it is about.

Everything that reads the database runs in a worker thread, in the
connection's principal's scope, exactly as a request does.
"""

from __future__ import annotations

import re
from typing import Any

from ..core.errors import AppError
from ..core.logging import logger
from ..core.principal import Principal
from ..core.scope import db_scope, scope_of_principal
from ..core.serial_ticket import tickets_in
from ..domain.queue.patient_view import patient_view_of
from ..domain.time import now_iso
from .auth import session_of
from .rooms import ROOMS, can_join_session

MAX_UNANSWERED = 500
MAX_DELTA_EVENTS = 500
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)


def read_session_id(message: Any) -> str | None:
    value = message.get("sessionId") if isinstance(message, dict) else None
    return value if isinstance(value, str) and value != "" else None


def read_last_seq(message: Any) -> int | None:
    value = message.get("lastSeq") if isinstance(message, dict) else None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if value != value or value in (float("inf"), float("-inf")) or value < 0:
        return None
    return value  # type: ignore[return-value]


def read_unanswered(message: Any) -> list[str]:
    value = message.get("unanswered") if isinstance(message, dict) else None
    if not isinstance(value, list):
        return []
    keys: list[str] = []
    for entry in value:
        if isinstance(entry, str) and _UUID.fullmatch(entry):
            lowered = entry.lower()
            if lowered not in keys:
                keys.append(lowered)
        if len(keys) >= MAX_UNANSWERED:
            break
    return keys


def error_envelope(thrown: BaseException) -> dict[str, Any]:
    error = thrown if isinstance(thrown, AppError) else AppError("INTERNAL", cause=thrown)
    if not isinstance(thrown, AppError):
        logger.error({}, "socket handler failed", exc=thrown)
    return {"type": "error.occurred", "serverTs": now_iso(), "data": error.to_body()["error"]}


def _holds_booking(principal: Principal, session_id: str) -> bool:
    if principal.kind == "staff":
        return False
    from ..services.queue import principal_holds_booking

    return principal_holds_booking(
        session_id,
        user_id=principal.id if principal.kind == "patient" else None,
        booking_id=principal.booking_id if principal.kind == "guest" else None,
    )


def ambient_rooms(sid: str) -> list[str]:
    """The rooms a connection joins on connect; runs in a worker thread."""
    session = session_of(sid)
    if session is None:
        return []
    from ..services.modules import modules_off
    from .rooms import ambient_rooms_for

    with db_scope(scope_of_principal(session.principal)):
        off = modules_off(session.principal.hospital_id or "") if session.principal.kind == "staff" else ()
        return ambient_rooms_for(session.principal, off)


def authorize_subscription(sid: str, message: Any) -> dict[str, Any]:
    """Step one of a `session:subscribe`, in a worker thread: may this
    connection hear this chamber, and in which room?

    Returns `{"room", "sessionId", "staff"}`, `{"error": envelope}` or
    `{"disconnect": True}`. The room is joined before the state is read
    (`catch_up`), so a broadcast made in between is never lost: the client
    folds by `seq` and ignores what it already has.
    """
    session = session_of(sid)
    if session is None:
        return {"disconnect": True}
    session_id = read_session_id(message)
    if session_id is None:
        return {"error": error_envelope(AppError("VALIDATION_FAILED", details={"field": "sessionId"}))}

    from ..services import queue as queue_service
    from ..services.desk_access import desk_limit
    from ..services.modules import first_off

    principal = session.principal
    try:
        with db_scope(scope_of_principal(principal)):
            record = queue_service.require_session(session_id)
            allowed = can_join_session(
                principal, hospital_id=record["hospitalId"], holds_booking=_holds_booking(principal, session_id)
            )
            limited = desk_limit(principal)
            if not allowed or (limited is not None and record["doctorId"] not in limited):
                return {"error": error_envelope(AppError("AUTH_FORBIDDEN_SCOPE", details={"room": "session"}))}
            if principal.kind == "staff" and first_off(record["hospitalId"], ["queue"]) is not None:
                return {"error": error_envelope(AppError("MODULE_OFF", details={"module": "queue"}))}
    except BaseException as thrown:  # noqa: BLE001
        return {"error": error_envelope(thrown)}
    staff = principal.kind == "staff"
    return {
        "room": ROOMS.session_staff(session_id) if staff else ROOMS.session(session_id),
        "sessionId": session_id,
        "staff": staff,
    }


def catch_up(sid: str, message: Any, session_id: str, staff: bool) -> dict[str, Any]:
    """Step two, after the room is joined: what the client missed.

    Returns `{"emits": [(event, payload)]}` or `{"error": envelope}`.
    """
    session = session_of(sid)
    if session is None:
        return {"emits": []}
    from ..services import queue as queue_service

    try:
        with db_scope(scope_of_principal(session.principal)):
            last_seq = read_last_seq(message)
            state = queue_service.get_state(session_id)
            etas = queue_service.get_etas(session_id)
            server_ts = now_iso()
            if not staff:
                return {
                    "emits": [
                        (
                            "queue.updated",
                            {
                                "type": "queue.updated",
                                "seq": state["lastSeq"],
                                "serverTs": server_ts,
                                "applied": [],
                                "data": patient_view_of(state, etas, tickets_in(session_id)),
                            },
                        )
                    ]
                }
            applied = queue_service.applied_among(session_id, read_unanswered(message), state["lastSeq"])
            settled = (
                "queue.updated",
                {
                    "type": "queue.updated",
                    "seq": state["lastSeq"],
                    "serverTs": server_ts,
                    "applied": applied,
                    "data": {"state": state, "etas": etas},
                },
            )
            if last_seq is None or state["lastSeq"] - last_seq > MAX_DELTA_EVENTS:
                return {"emits": [settled]}
            missed = queue_service.events_since(session_id, last_seq)
            emits = [
                (
                    "queue.event",
                    {"type": event["type"], "seq": event["seq"], "serverTs": event["serverTs"], "data": event},
                )
                for event in missed
            ]
            emits.append(settled)
            return {"emits": emits}
    except BaseException as thrown:  # noqa: BLE001
        return {"error": error_envelope(thrown)}
