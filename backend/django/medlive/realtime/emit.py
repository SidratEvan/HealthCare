"""Typed publishers, and the seam the transport plugs into (port of `realtime/emit.ts`).

Services publish through the functions below and never import the socket
server. Until the server attaches (`realtime/server.py`), a
`RecordingEmitter` records instead of sending, which is what tests assert on.
"""

from __future__ import annotations

import threading
from typing import Any, Protocol

from ..core.logging import logger
from ..core.serial_ticket import tickets_in
from ..domain.queue.patient_view import patient_view_of
from .rooms import ROOMS


class RealtimeEmitter(Protocol):
    def emit(self, room: str, event: str, envelope: dict[str, Any]) -> None: ...


class RecordingEmitter:
    def __init__(self) -> None:
        self._sent: list[dict[str, Any]] = []
        self._lock = threading.Lock()

    def emit(self, room: str, event: str, envelope: dict[str, Any]) -> None:
        with self._lock:
            self._sent.append({"room": room, "event": event, "envelope": envelope})
        logger.debug({"room": room, "event": event, "seq": envelope.get("seq")}, "realtime emit")

    def all(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._sent)

    def for_room(self, room: str) -> list[dict[str, Any]]:
        with self._lock:
            return [{"event": e["event"], "envelope": e["envelope"]} for e in self._sent if e["room"] == room]

    def clear(self) -> None:
        with self._lock:
            self._sent.clear()


_current: RealtimeEmitter = RecordingEmitter()


def emitter() -> RealtimeEmitter:
    return _current


def set_emitter(next_emitter: RealtimeEmitter) -> None:
    global _current
    _current = next_emitter


def reset_emitter() -> RecordingEmitter:
    fresh = RecordingEmitter()
    set_emitter(fresh)
    return fresh


def _envelope(event_type: str, server_ts: str, data: Any, **extra: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"type": event_type}
    if "seq" in extra:
        out["seq"] = extra.pop("seq")
    out["serverTs"] = server_ts
    out.update(extra)
    out["data"] = data
    return out


# --- The chamber -------------------------------------------------------------


def queue_updated(
    session_id: str,
    payload: dict[str, Any],
    seq: int,
    server_ts: str,
    applied: list[dict[str, Any]] | None = None,
) -> None:
    """`queue.updated`: the broadcast the product is built around (FR-QUE-40, NFR-01).

    Staff hear the queue as reception holds it; the patients' room gets the
    copy that names nobody (plan I2c).
    """
    emitter().emit(
        ROOMS.session_staff(session_id),
        "queue.updated",
        _envelope("queue.updated", server_ts, payload, seq=seq, applied=list(applied or [])),
    )
    emitter().emit(
        ROOMS.session(session_id),
        "queue.updated",
        _envelope(
            "queue.updated",
            server_ts,
            patient_view_of(payload["state"], payload["etas"], tickets_in(session_id)),
            seq=seq,
            applied=[],
        ),
    )


def session_delayed(session_id: str, data: dict[str, Any], seq: int, server_ts: str) -> None:
    for room in (ROOMS.session_staff(session_id), ROOMS.session(session_id)):
        emitter().emit(room, "session.delayed", _envelope("session.delayed", server_ts, data, seq=seq))


def session_ended(session_id: str, seq: int, server_ts: str) -> None:
    for room in (ROOMS.session_staff(session_id), ROOMS.session(session_id)):
        emitter().emit(room, "session.ended", _envelope("session.ended", server_ts, {}, seq=seq))


def patient_called(patient_id: str, data: dict[str, Any], seq: int, server_ts: str) -> None:
    emitter().emit(ROOMS.patient(patient_id), "patient.called", _envelope("patient.called", server_ts, data, seq=seq))


# --- The bed board -----------------------------------------------------------


def bed_updated(hospital_id: str, data: dict[str, Any], server_ts: str) -> None:
    emitter().emit(ROOMS.beds(hospital_id), "bed.updated", _envelope("bed.updated", server_ts, data))


def capacity_updated(hospital_id: str, capacity: dict[str, Any], server_ts: str) -> None:
    emitter().emit(ROOMS.beds(hospital_id), "capacity.updated", _envelope("capacity.updated", server_ts, capacity))


def bed_request_updated(hospital_id: str, data: dict[str, Any], server_ts: str) -> None:
    emitter().emit(
        ROOMS.beds(hospital_id), "bedrequest.updated", _envelope("bedrequest.updated", server_ts, data)
    )


# --- Emergency and referrals -----------------------------------------------------


def emergency_inbound(hospital_id: str, data: dict[str, Any], server_ts: str) -> None:
    emitter().emit(
        ROOMS.emergency(hospital_id), "emergency.inbound", _envelope("emergency.inbound", server_ts, data)
    )


def emergency_updated(hospital_id: str, data: dict[str, Any], server_ts: str) -> None:
    emitter().emit(
        ROOMS.emergency(hospital_id), "emergency.updated", _envelope("emergency.updated", server_ts, data)
    )


def capabilities_updated(hospital_id: str, data: dict[str, Any], server_ts: str) -> None:
    emitter().emit(
        ROOMS.emergency(hospital_id),
        "capabilities.updated",
        _envelope("capabilities.updated", server_ts, data),
    )


def emergency_handoff(hospital_id: str, data: dict[str, Any], server_ts: str) -> None:
    emitter().emit(ROOMS.beds(hospital_id), "emergency.handoff", _envelope("emergency.handoff", server_ts, data))


def referral_incoming(hospital_id: str, data: dict[str, Any], server_ts: str) -> None:
    emitter().emit(
        ROOMS.emergency(hospital_id), "referral.incoming", _envelope("referral.incoming", server_ts, data)
    )


def referral_updated(hospital_ids: list[str], data: dict[str, Any], server_ts: str) -> None:
    seen: list[str] = []
    for hospital_id in hospital_ids:
        if hospital_id in seen:
            continue
        seen.append(hospital_id)
        emitter().emit(
            ROOMS.emergency(hospital_id), "referral.updated", _envelope("referral.updated", server_ts, data)
        )


# --- The lab -----------------------------------------------------------------------


def test_ordered(hospital_id: str, data: dict[str, Any], server_ts: str) -> None:
    emitter().emit(ROOMS.lab(hospital_id), "test.ordered", _envelope("test.ordered", server_ts, data))


def test_updated(hospital_id: str, data: dict[str, Any], server_ts: str) -> None:
    emitter().emit(ROOMS.lab(hospital_id), "test.updated", _envelope("test.updated", server_ts, data))
