"""Queue controllers (port of `controllers/queue.controller.ts`; BACKEND.md §7.4).

A controller decides who is asking about what, builds the payload, and hands
it to the queue service. Hospital scope, the desk rule and booking ownership
are checked here; the queue rules are the service's.
"""

from __future__ import annotations

import time as _time
from datetime import datetime, timezone
from typing import Any

from ..core.errors import AppError, forbidden_scope, not_found
from ..core.http import ApiRequest, Reply, ok
from ..core.principal import Principal
from ..core.serial_ticket import tickets_in
from ..domain.queue.patient_view import patient_view_of
from ..domain.queue.rate import measured_consult_seconds
from ..domain.queue.rules import UNDO_WINDOW_SECONDS
from ..domain.time import difference_in_minutes, from_datetime, now_iso, now_ms, parse_ms, utc_now
from ..services import queue as queue_service
from ..services.desk_access import assert_desk_allows

UNDO_WINDOW_MS = UNDO_WINDOW_SECONDS * 1000


def get_queue(req: ApiRequest) -> Reply:
    session_id = _param(req, "id")
    _assert_session_scope(req, session_id)
    state = queue_service.get_state(session_id)
    etas = queue_service.get_etas(session_id)
    bookings = queue_service.list_bookings(session_id)
    cached = queue_service.get_cached_state(session_id)
    fresh_at = cached["updatedAt"] if cached is not None else utc_now()
    return ok(
        {"state": state, "etas": etas, "bookings": bookings, "freshAt": from_datetime(fresh_at), "serverTs": now_iso()}
    )


def declare_arrived(req: ApiRequest) -> Reply:
    session_id = _param(req, "id")
    session = _assert_session_scope(req, session_id)
    arrived_at = now_iso()
    minutes_late = difference_in_minutes(arrived_at, from_datetime(session["plannedStart"]))
    return _send(
        req,
        queue_service.append_event(
            {
                "sessionId": session_id,
                "type": "DOCTOR_ARRIVED",
                "payload": {"arrivedAt": arrived_at, "minutesLate": minutes_late},
                "actor": actor_of(req),
                **_envelope(req),
            }
        ),
    )


def declare_delay(req: ApiRequest) -> Reply:
    session_id = _param(req, "id")
    _assert_session_scope(req, session_id)
    body = req.body
    return _send(
        req,
        queue_service.append_event(
            {
                "sessionId": session_id,
                "type": "DELAY_DECLARED",
                "payload": {"minutes": body["minutes"], "reason": body["reason"], "declaredBy": body["declaredBy"]},
                "actor": actor_of(req),
                **_envelope(req),
            }
        ),
    )


def _session_command(req: ApiRequest, kind: str, payload: dict[str, Any]) -> Reply:
    session_id = _param(req, "id")
    _assert_session_scope(req, session_id)
    return _send(
        req,
        queue_service.append_event(
            {"sessionId": session_id, "type": kind, "payload": payload, "actor": actor_of(req), **_envelope(req)}
        ),
    )


def pause_session(req: ApiRequest) -> Reply:
    return _session_command(req, "SESSION_PAUSED", {"reason": req.body["reason"]})


def resume_session(req: ApiRequest) -> Reply:
    return _session_command(req, "SESSION_RESUMED", {})


def end_session(req: ApiRequest) -> Reply:
    return _session_command(req, "SESSION_ENDED", {"reason": req.body["reason"]})


def call_next(req: ApiRequest) -> Reply:
    session_id = _param(req, "id")
    _assert_session_scope(req, session_id)
    envelope = _envelope(req)
    return _send(
        req,
        queue_service.call_next(
            session_id=session_id,
            actor=actor_of(req),
            client_event_id=envelope["clientEventId"],
            client_ts=envelope["clientTs"],
        ),
    )


def _booking_command(req: ApiRequest, kind: str, payload: dict[str, Any], session_id: str) -> Reply:
    return _send(
        req,
        queue_service.append_event(
            {"sessionId": session_id, "type": kind, "payload": payload, "actor": actor_of(req), **_envelope(req)}
        ),
    )


def _entry(session_id: str, booking_id: str) -> dict[str, Any] | None:
    state = queue_service.get_state(session_id)
    return next((e for e in state["entries"] if e["bookingId"] == booking_id), None)


def mark_done(req: ApiRequest) -> Reply:
    scoped = assert_booking_scope(req)
    booking, session_id = scoped["booking"], scoped["sessionId"]
    entry = _entry(session_id, booking["id"])
    called_at = None if entry is None else entry["calledAt"]
    return _booking_command(
        req,
        "PATIENT_DONE",
        {"bookingId": booking["id"], "consultSeconds": measured_consult_seconds(called_at, now_iso())},
        session_id,
    )


def mark_late(req: ApiRequest) -> Reply:
    scoped = assert_booking_scope(req)
    return _booking_command(
        req,
        "PATIENT_LATE",
        {"bookingId": scoped["booking"]["id"], "expectedMinutes": req.body["expectedMinutes"]},
        scoped["sessionId"],
    )


def mark_no_show(req: ApiRequest) -> Reply:
    scoped = assert_booking_scope(req)
    booking, session_id = scoped["booking"], scoped["sessionId"]
    entry = _entry(session_id, booking["id"])
    grace = 0 if entry is None or entry["late"] is None else difference_in_minutes(now_iso(), entry["late"]["declaredAt"])
    return _booking_command(req, "PATIENT_NO_SHOW", {"bookingId": booking["id"], "graceUsedMinutes": grace}, session_id)


def check_in(req: ApiRequest) -> Reply:
    scoped = assert_booking_scope(req)
    return _booking_command(
        req,
        "PATIENT_ARRIVED",
        {"bookingId": scoped["booking"]["id"], "quotedWaitMinutes": req.body["quotedWaitMinutes"]},
        scoped["sessionId"],
    )


def reinstate(req: ApiRequest) -> Reply:
    scoped = assert_booking_scope(req)
    state = queue_service.get_state(scoped["sessionId"])
    in_chamber = sum(1 for e in state["entries"] if e["status"] == "in_chamber")
    return _booking_command(
        req,
        "PATIENT_REINSERTED",
        {"bookingId": scoped["booking"]["id"], "newPosition": in_chamber + 1},
        scoped["sessionId"],
    )


def add_walkin(req: ApiRequest) -> Reply:
    session_id = _param(req, "id")
    _assert_session_scope(req, session_id)
    body = req.body
    principal = req.principal
    if principal is None or principal.kind != "staff":
        raise forbidden_scope({"reason": "staff_only"})
    envelope = _envelope(req)
    return _send(
        req,
        queue_service.add_walkin(
            session_id=session_id,
            patient_id=body["patientId"],
            position=body["position"],
            index=body["index"],
            reason=body["reason"],
            actor={"kind": "staff", "staffUserId": principal.id, "role": "receptionist"},
            client_event_id=envelope["clientEventId"],
            client_ts=envelope["clientTs"],
        ),
    )


def reorder(req: ApiRequest) -> Reply:
    session_id = _param(req, "id")
    _assert_session_scope(req, session_id)
    body = req.body
    state = queue_service.get_state(session_id)
    from_index = next((i for i, e in enumerate(state["entries"]) if e["bookingId"] == body["bookingId"]), -1)
    if from_index == -1:
        raise not_found("booking")
    return _send(
        req,
        queue_service.append_event(
            {
                "sessionId": session_id,
                "type": "PRIORITY_REORDERED",
                "payload": {
                    "bookingId": body["bookingId"],
                    "fromIndex": from_index,
                    "toIndex": body["toIndex"],
                    "reason": body["reason"],
                },
                "actor": actor_of(req),
                **_envelope(req),
            }
        ),
    )


def undo(req: ApiRequest) -> Reply:
    """Ten seconds, and only the actor who did it (GR-02)."""
    event_id = _param(req, "id")
    original = queue_service.require_event(event_id)
    _assert_session_scope(req, original["sessionId"])
    age = now_ms() - parse_ms(original["serverTs"])
    if age > UNDO_WINDOW_MS:
        raise AppError(
            "QUEUE_GUARD_FAILED",
            message="That action is past the undo window.",
            details={"guard": "UNDO_WINDOW_EXPIRED", "windowMs": UNDO_WINDOW_MS},
        )
    actor = actor_of(req)
    if not _same_actor(original["actor"], actor):
        raise forbidden_scope({"reason": "undo_requires_original_actor"})
    return _send(
        req,
        queue_service.append_event(
            {
                "sessionId": original["sessionId"],
                "type": "ACTION_UNDONE",
                "payload": {"undoneEventId": event_id},
                "actor": actor,
                **_envelope(req),
            }
        ),
    )


def offer_slot(req: ApiRequest) -> Reply:
    scoped = assert_booking_scope(req)
    envelope = _envelope(req)
    return _send(
        req,
        queue_service.offer_freed_slot(
            session_id=scoped["sessionId"],
            freed_booking_id=scoped["booking"]["id"],
            actor=actor_of(req),
            client_event_id=envelope["clientEventId"],
            client_ts=envelope["clientTs"],
        ),
    )


def accept_offer(req: ApiRequest) -> Reply:
    offer_id = _param(req, "id")
    offer = queue_service.require_offer(offer_id)
    _assert_session_scope(req, offer["sessionId"])
    envelope = _envelope(req)
    return _send(
        req,
        queue_service.accept_slot(
            offer_id=offer_id,
            actor=actor_of(req),
            client_event_id=envelope["clientEventId"],
            client_ts=envelope["clientTs"],
        ),
    )


def get_standby(req: ApiRequest) -> Reply:
    session_id = _param(req, "id")
    _assert_session_scope(req, session_id)
    queue_service.expire_lapsed_offers(session_id, actor_of(req))
    standby = queue_service.standby_for(session_id)
    return ok(
        {
            "waiting": [
                {"id": row["id"], "patientId": row["patientId"], "position": row["position"], "prepaid": row["prepaid"]}
                for row in standby["waiting"]
            ],
            "offers": [
                {
                    "id": offer["id"],
                    "freedBookingId": offer["freedBookingId"],
                    "offeredToPatientId": offer["offeredToPatientId"],
                    "offeredAt": from_datetime(offer["offeredAt"]),
                    "expiresAt": from_datetime(offer["expiresAt"]),
                    "acceptedAt": None if offer["acceptedAt"] is None else from_datetime(offer["acceptedAt"]),
                    "recoveredValuePoisha": offer["recoveredValuePoisha"],
                }
                for offer in standby["offers"]
            ],
            "serverTs": now_iso(),
        }
    )


# --- Helpers -----------------------------------------------------------------------


def _param(req: ApiRequest, name: str) -> str:
    value = req.params.get(name) if isinstance(req.params, dict) else None
    if not isinstance(value, str) or value == "":
        raise not_found("route parameter")
    return value


def _send(req: ApiRequest, result: dict[str, Any]) -> Reply:
    return ok(queue_answer(req, result))


def queue_answer(req: ApiRequest, result: dict[str, Any]) -> dict[str, Any]:
    """Staff are answered with the queue as reception holds it; anybody else the patients' copy."""
    receipt = {"seq": result["seq"], "duplicate": result["duplicate"], "serverTs": result["serverTs"]}
    if req.principal is not None and req.principal.kind == "staff":
        out = {"state": result["state"], "etas": result["etas"], **receipt}
        if "walkin" in result:
            out["walkin"] = result["walkin"]
        return out
    session_id = result["state"]["plan"]["sessionId"]
    return {**patient_view_of(result["state"], result["etas"], tickets_in(session_id)), **receipt}


def _envelope(req: ApiRequest) -> dict[str, Any]:
    body = req.body if isinstance(req.body, dict) else {}
    return {"clientEventId": body.get("clientEventId"), "clientTs": body.get("clientTs")}


def actor_of(req: ApiRequest) -> dict[str, Any]:
    principal = req.principal
    if principal is None:
        return {"kind": "system", "job": "anonymous"}
    if principal.kind == "staff":
        return {
            "kind": "staff",
            "staffUserId": principal.id,
            "role": principal.roles[0] if principal.roles else "receptionist",
        }
    if principal.kind == "patient":
        return {"kind": "patient", "userId": principal.id}
    if principal.kind == "guest":
        return {"kind": "guest", "bookingId": principal.booking_id or ""}
    raise forbidden_scope({"reason": "national_role", "was": principal.kind})


def _same_actor(a: dict[str, Any], b: dict[str, Any]) -> bool:
    if a["kind"] != b["kind"]:
        return False
    if a["kind"] == "staff":
        return a["staffUserId"] == b["staffUserId"]
    if a["kind"] == "patient":
        return a["userId"] == b["userId"]
    if a["kind"] == "guest":
        return a["bookingId"] == b["bookingId"]
    return False


def _assert_session_scope(req: ApiRequest, session_id: str) -> dict[str, Any]:
    session = queue_service.require_session(session_id)
    principal = req.principal
    if principal is None:
        raise forbidden_scope({"reason": "no_principal"})
    if principal.kind == "staff" and principal.hospital_id != session["hospitalId"]:
        raise forbidden_scope({"reason": "wrong_hospital"})
    assert_desk_allows(principal, session)
    return session


assert_session_scope = _assert_session_scope


def assert_booking_scope(req: ApiRequest) -> dict[str, Any]:
    return assert_booking_scope_for(req, _param(req, "id"))


def assert_booking_scope_for(req: ApiRequest, booking_id: str) -> dict[str, Any]:
    booking = queue_service.require_booking(booking_id)
    session = _assert_session_scope(req, booking["sessionId"])
    principal = req.principal
    if principal is not None and principal.kind != "staff":
        owner = queue_service.booking_owner(booking_id)
        if owner is None or not _owns_booking(principal, owner, booking_id):
            raise forbidden_scope({"reason": "not_your_booking"})
    return {"booking": booking, "sessionId": session["id"]}


def _owns_booking(principal: Principal, owner: dict[str, Any], booking_id: str) -> bool:
    if principal.kind == "patient":
        return owner["userId"] == principal.id
    if principal.kind == "guest":
        return principal.booking_id is not None and principal.booking_id == booking_id
    return False
