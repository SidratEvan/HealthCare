"""The test seam: what the Node API suite needs to see of this process
(mounted only when NODE_ENV=test; `routes/__init__.py`).

The Node suite asserts on its in-process recording emitter. Run against this
server, it reads this process's recording instead (`tests/node_suite/emit-shim.ts`).
"""

from __future__ import annotations

from typing import Any

from ..core.errors import AppError
from ..core.http import ApiRequest, Reply, ok
from ..core.router import Router
from ..realtime.emit import RecordingEmitter, emitter

routes = Router()


def _recorder() -> RecordingEmitter | None:
    current = emitter()
    if isinstance(current, RecordingEmitter):
        return current
    return getattr(current, "recorder", None)


def emitted(req: ApiRequest) -> Reply:
    recorder = _recorder()
    return ok([] if recorder is None else recorder.all())


def reset(req: ApiRequest) -> Reply:
    recorder = _recorder()
    if recorder is not None:
        recorder.clear()
    return ok(True)


def sweep(req: ApiRequest) -> Reply:
    """Runs the periodic revocation sweep now (`realtime-auth-shim.ts`)."""
    from ..realtime.auth import sweep_revoked

    return ok(sweep_revoked())


def rooms(req: ApiRequest) -> Reply:
    """The rooms one connection is in, as `io.sockets.sockets.get(id).rooms` (`realtime-server-shim.ts`)."""
    from ..realtime.server import sio

    sid = req.query_raw.get("sid")
    if not isinstance(sid, str) or sid == "":
        return ok(None)
    try:
        held = sio.rooms(sid, namespace="/")
    except (KeyError, ValueError):
        return ok(None)
    return ok(None if not held else list(held))


def _queue_calls() -> dict[str, Any]:
    from ..services import queue as q

    return {
        "queue.appendEvent": lambda data: q.append_event(data),
        "queue.callNext": lambda data: q.call_next(
            session_id=data["sessionId"],
            actor=data["actor"],
            client_event_id=data.get("clientEventId"),
            client_ts=data.get("clientTs"),
            expected_booking_id=data.get("expectedBookingId"),
        ),
        "queue.appendBatch": lambda data: q.append_batch(
            session_id=data["sessionId"], actor=data["actor"], entries=data["entries"]
        ),
        "queue.setCapacity": lambda session_id, capacity: q.set_capacity(session_id, capacity),
        "queue.createWalkinBooking": lambda data: q.create_walkin_booking(
            session_id=data["sessionId"],
            patient_id=data["patientId"],
            fee_poisha=data["feePoisha"],
            staff_user_id=data["staffUserId"],
        ),
        "queue.getState": lambda session_id: q.get_state(session_id),
        "queue.waitingCount": lambda session_id: q.waiting_count(session_id),
        "queue.bookingOwner": lambda booking_id: q.booking_owner(booking_id),
    }


def _notification_calls() -> dict[str, Any]:
    from ..services import notification as n
    from ..services import notification_sender as sender

    def forget_templates() -> None:
        n.forget_templates()

    return {
        "notifications.settled": lambda: n.settled(),
        # A batch the Node test queued in its own transaction: the rows are in
        # the table, and the sender takes them from there.
        "notifications.dispatch": lambda batch=None: sender.wake(),
        "notifications.forgetTemplates": forget_templates,
    }


def call(req: ApiRequest) -> Reply:
    """Runs one service function the Node suite called directly (`tests/node_suite/call.ts`).

    Only the functions listed are callable; an AppError is answered as the API
    answers one, so the caller can rethrow it as the Node AppError.
    """
    body = req.body if isinstance(req.body, dict) else {}
    calls = {**_queue_calls(), **_notification_calls()}
    fn = calls.get(body.get("fn"))
    if fn is None:
        raise AppError("NOT_FOUND", details={"fn": body.get("fn")})
    from ..core.scope import SYSTEM, db_scope

    # A direct call in the Node process runs in no request, so in the system scope.
    with db_scope(SYSTEM):
        return ok(fn(*body.get("args", [])))


routes.get("/__test__/emitted", emitted)
routes.post("/__test__/call", call)
routes.get("/__test__/realtime/rooms", rooms)
routes.post("/__test__/emitted/reset", reset)
routes.post("/__test__/realtime/sweep", sweep)
