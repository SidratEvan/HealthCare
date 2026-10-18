"""The queue service: the single entry point for every queue mutation
(port of `services/queue.service.ts`; BACKEND.md §4).

`append_event` runs BACKEND.md §4.1's steps in order, inside one transaction
that holds the session row: idempotency, lock, load, validate, append,
reduce, persist, recalculate, queue messages. The rooms are told only after
the commit (`_committed`), and the messages are sent only after that.

Exactly one path by which a fact enters the log; the reducer is the shared
domain's (`medlive.domain.queue`, held to the TypeScript by parity vectors).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from ..core import db
from ..core.errors import AppError, guard_failed, not_found
from ..core.logging import logger
from ..core.scope import as_queue
from ..domain.queue import rules
from ..domain.queue.eta import compute_etas, projected_end
from ..domain.queue.events import is_material_event
from ..domain.queue.rate import measured_consult_seconds
from ..domain.queue.replay import continue_replay, replay
from ..domain.queue.state import empty_state, find_entry, now_serving, project, waiting_queue
from ..domain.time import from_datetime, now_iso, utc_now
from ..realtime import emit
from ..repositories import booking as booking_repo
from ..repositories import notification as notification_repo
from ..repositories import payment as payment_repo
from ..repositories import queue_event as event_repo
from ..repositories import queue_state as state_repo
from ..repositories import session as session_repo
from ..repositories import standby as standby_repo
from . import notification as notifications
from .links import standby_link_for

EXPIRY_NAMESPACE = uuid.UUID("a1b0f2c4-5d6e-4f70-8a91-2b3c4d5e6f70")

Tell = list[Callable[[], None]]


def _now() -> datetime:
    return utc_now()


def _now_ts() -> str:
    return now_iso()


def _committed(body: Callable[[Tell], Any]) -> Any:
    """A transaction, and then the broadcasts its body registered, once committed.

    A screen that subscribed between an early broadcast and the commit would
    read a state without the write; a write that rolled back would have told
    every screen about a queue that never existed. So: commit, then tell.
    """
    tell: Tell = []
    with db.transaction():
        value = body(tell)
    for say in tell:
        say()
    return value


def _result(state: dict[str, Any], seq: int, duplicate: bool, server_ts: str) -> dict[str, Any]:
    return {
        "state": state,
        "etas": compute_etas(state, _now_ts()),
        "seq": seq,
        "duplicate": duplicate,
        "serverTs": server_ts,
    }


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def append_event(data: dict[str, Any]) -> dict[str, Any]:
    """Appends one fact to a session's log; returns the state, ETAs and sequence."""
    with as_queue():
        replayed = find_replay(data.get("clientEventId"), data["sessionId"])
        if replayed is not None:
            return replayed

        def body(tell: Tell) -> dict[str, Any]:
            session = _lock_session(data["sessionId"])
            before = _load_state(session)
            applied = _apply_one(session, before, data)
            return _settle(tell, session, applied["state"], [applied["event"]])

        settled = _committed(body)
        notifications.dispatch(settled["batch"])
        _after_session_ended(data["type"], data["sessionId"])
        return settled["result"]


def _after_session_ended(kind: str, session_id: str) -> None:
    """`FR-PAY-07`, after the commit and never able to fail the event."""
    if kind != "SESSION_ENDED":
        return
    from . import payment as payments

    try:
        payments.raise_refunds_for_ended_session(session_id)
    except Exception as error:  # noqa: BLE001
        logger.error({"sessionId": session_id}, "could not raise refund eligibility", exc=error)


def call_next(
    *,
    session_id: str,
    actor: dict[str, Any],
    client_event_id: str | None = None,
    client_ts: str | None = None,
    expected_booking_id: str | None = None,
) -> dict[str, Any]:
    """Finish whoever is in the chamber and call the next, decided inside the lock (FR-QUE-53)."""
    with as_queue():
        original = client_event_id
        replayed = find_replay(derive(original, "c"), session_id) or find_replay(derive(original, "d"), session_id)
        if replayed is not None:
            return replayed

        def body(tell: Tell) -> dict[str, Any]:
            session = _lock_session(session_id)
            state = _load_state(session)
            events: list[dict[str, Any]] = []
            if original is not None:
                again = event_repo.find_by_client_event_id(str(derive(original, "c"))) or event_repo.find_by_client_event_id(
                    str(derive(original, "d"))
                )
                if again is not None:
                    return {"result": _result(state, state["lastSeq"], True, _now_ts()), "batch": notifications.NOTHING}

            serving = now_serving(state)
            if expected_booking_id is not None and (serving or {}).get("bookingId") != expected_booking_id:
                raise guard_failed("CONSULTATION_CHANGED", "The signed encounter is no longer in the chamber.")
            if serving is not None:
                applied = _apply_one(
                    session,
                    state,
                    {
                        "sessionId": session_id,
                        "type": "PATIENT_DONE",
                        "payload": {
                            "bookingId": serving["bookingId"],
                            "consultSeconds": measured_consult_seconds(serving["calledAt"], _now_ts()),
                        },
                        "actor": actor,
                        "clientEventId": derive(client_event_id, "d"),
                        "clientTs": client_ts,
                    },
                )
                state = applied["state"]
                events.append(applied["event"])

            following = rules.next_to_call(state)
            if following is not None:
                applied = _apply_one(
                    session,
                    state,
                    {
                        "sessionId": session_id,
                        "type": "PATIENT_CALLED",
                        "payload": {"bookingId": following["bookingId"], "serial": following["serial"]},
                        "actor": actor,
                        "clientEventId": derive(client_event_id, "c"),
                        "clientTs": client_ts,
                    },
                )
                state = applied["state"]
                events.append(applied["event"])

            if not events:
                return {"result": _result(state, state["lastSeq"], False, _now_ts()), "batch": notifications.NOTHING}
            return _settle(tell, session, state, events)

        settled = _committed(body)
        notifications.dispatch(settled["batch"])
        return settled["result"]


def offer_freed_slot(
    *,
    session_id: str,
    freed_booking_id: str,
    actor: dict[str, Any],
    client_event_id: str | None = None,
    client_ts: str | None = None,
) -> dict[str, Any]:
    """Give an empty chair to the standby list, the next person chosen under the lock (FR-QUE-30)."""
    with as_queue():
        replayed = find_replay(client_event_id, session_id)
        if replayed is not None:
            return replayed

        def body(tell: Tell) -> dict[str, Any]:
            session = _lock_session(session_id)
            state = _load_state(session)
            guard = rules.can_offer_freed_slot(state, freed_booking_id)
            if not guard["ok"]:
                raise guard_failed(guard["code"], guard["detail"])
            now = _now()
            standby = standby_repo.claim_next_standby(session_id, now)
            if standby is None:
                raise AppError(
                    "QUEUE_GUARD_FAILED",
                    message="Nobody is on the standby list for this session.",
                    details={"guard": "NO_STANDBY"},
                )
            expires_at = now + timedelta(minutes=rules.SLOT_OFFER_WINDOW_MINUTES)
            offer_id = standby_repo.insert_offer(
                session_id=session_id,
                freed_booking_id=freed_booking_id,
                offered_to_patient_id=standby["patientId"],
                expires_at=expires_at,
            )
            offered = _apply_one(
                session,
                state,
                {
                    "sessionId": session_id,
                    "type": "SLOT_OFFERED",
                    "payload": {
                        "offerId": offer_id,
                        "freedBookingId": freed_booking_id,
                        "offeredTo": [standby["patientId"]],
                        "expiresAt": from_datetime(expires_at),
                    },
                    "actor": actor,
                    "clientEventId": client_event_id,
                    "clientTs": client_ts,
                },
            )

            if standby["prepaid"]:
                seat = _seat_on_offer(
                    session,
                    offered["state"],
                    offer={
                        "id": offer_id,
                        "sessionId": session_id,
                        "freedBookingId": freed_booking_id,
                        "offeredToPatientId": standby["patientId"],
                    },
                    actor=lambda _booking_id: actor,
                    at=now,
                    client_event_id=derive(client_event_id, "c"),
                    client_ts=client_ts,
                )
                both = _settle(tell, session, seat["applied"]["state"], [offered["event"], seat["applied"]["event"]])
                subject = standby["guestId"] or standby["patientId"]
                seated_message = notifications.queue_slot_seated(
                    session_id=session_id,
                    patient_id=standby["patientId"],
                    phone=standby["contactPhone"],
                    serial=seat["serial"],
                    link=standby_link_for(standby["id"], subject),
                    standby={"id": standby["id"], "subject": subject},
                )
                return {"result": both["result"], "batch": notifications.merge(both["batch"], seated_message)}

            settled_offer = _settle(tell, session, offered["state"], [offered["event"]])
            guest_id = standby["guestId"]
            offer_message = notifications.queue_slot_offer(
                session_id=session_id,
                patient_id=standby["patientId"],
                phone=standby["contactPhone"],
                expires_at=from_datetime(expires_at),
                link=None if guest_id is None else standby_link_for(standby["id"], guest_id),
                standby=None if guest_id is None else {"id": standby["id"], "subject": guest_id},
            )
            return {"result": settled_offer["result"], "batch": notifications.merge(settled_offer["batch"], offer_message)}

        settled = _committed(body)
        notifications.dispatch(settled["batch"])
        return settled["result"]


def accept_slot(*, offer_id: str, actor: dict[str, Any], client_event_id: str | None = None, client_ts: str | None = None) -> dict[str, Any]:
    """Reception's route for somebody who rang the counter (FR-QUE-30, FR-ADM-03)."""
    return accept_slot_detailed(
        offer_id=offer_id, actor=lambda _booking_id: actor, client_event_id=client_event_id, client_ts=client_ts
    )["result"]


def accept_slot_detailed(
    *,
    offer_id: str,
    actor: Callable[[str], dict[str, Any]],
    client_event_id: str | None = None,
    client_ts: str | None = None,
) -> dict[str, Any]:
    """Accepts an offer and says which booking it made."""
    with as_queue():
        offer = standby_repo.find_offer(offer_id)
        if offer is None:
            raise not_found("offer")
        replayed = find_replay(client_event_id, offer["sessionId"])
        if replayed is not None:
            return {"result": replayed, "newBookingId": None, "serial": None}

        def body(tell: Tell) -> dict[str, Any]:
            session = _lock_session(offer["sessionId"])
            before = _load_state(session)
            guard = rules.can_accept_slot(before, offer_id, _now_ts())
            if not guard["ok"]:
                raise guard_failed(guard["code"], guard["detail"])
            seat = _seat_on_offer(
                session,
                before,
                offer={
                    "id": offer["id"],
                    "sessionId": offer["sessionId"],
                    "freedBookingId": offer["freedBookingId"],
                    "offeredToPatientId": offer["offeredToPatientId"],
                },
                actor=actor,
                at=_now(),
                client_event_id=client_event_id,
                client_ts=client_ts,
            )
            done = _settle(tell, session, seat["applied"]["state"], [seat["applied"]["event"]])
            return {"done": done, "seat": seat}

        settled = _committed(body)
        notifications.dispatch(settled["done"]["batch"])
        return {
            "result": settled["done"]["result"],
            "newBookingId": settled["seat"]["newBookingId"],
            "serial": settled["seat"]["serial"],
        }


def _seat_on_offer(
    session: dict[str, Any],
    before: dict[str, Any],
    *,
    offer: dict[str, Any],
    actor: Callable[[str], dict[str, Any]],
    at: datetime,
    client_event_id: str | None,
    client_ts: str | None,
) -> dict[str, Any]:
    """Gives an offered chair to the person it was offered to.

    A cancelled serial still ahead of the chamber is reissued; otherwise the
    next serial is issued (open decision 13, `bookings_session_serial_key`).
    """
    from ..domain.admin.recovery import recovered_value_for

    claimed = standby_repo.mark_accepted(offer["id"], recovered_value_for(session["feePoisha"]), at)
    if not claimed:
        raise AppError("QUEUE_CONFLICT", message="Somebody else took that slot first.", details={"offerId": offer["id"]})
    freed = None if offer["freedBookingId"] is None else find_entry(before, offer["freedBookingId"])
    serving = now_serving(before)
    passed = 0 if serving is None else serving["serial"]
    highest = max([0, *(entry["serial"] for entry in before["entries"])])
    serial = (
        freed["serial"]
        if freed is not None and freed["status"] == "cancelled" and freed["serial"] > passed
        else highest + 1
    )
    standby = standby_repo.active_for(offer["sessionId"], offer["offeredToPatientId"])
    guest_id = None if standby is None else standby["guestId"]
    new_booking_id = booking_repo.insert_booking(
        session_id=offer["sessionId"],
        patient_id=offer["offeredToPatientId"],
        serial=serial,
        source="counter" if guest_id is None else "guest_link",
        fee_poisha=session["feePoisha"],
        booked_by_user_id=None,
        booked_by_guest_id=guest_id,
        reason_text=None,
        intake={},
    )
    if standby is None:
        standby_repo.remove_from_standby(offer["sessionId"], offer["offeredToPatientId"], at)
    else:
        payment_repo.move_standby_to_booking(standby["id"], new_booking_id)
        standby_repo.mark_seated(standby["id"], new_booking_id, at)
    state = _load_state(session)
    applied = _apply_one(
        session,
        state,
        {
            "sessionId": offer["sessionId"],
            "type": "SLOT_ACCEPTED",
            "payload": {"offerId": offer["id"], "newBookingId": new_booking_id},
            "actor": actor(new_booking_id),
            "clientEventId": client_event_id,
            "clientTs": client_ts,
        },
    )
    return {"applied": applied, "newBookingId": new_booking_id, "serial": serial}


def decline_slot(*, offer_id: str, actor: dict[str, Any]) -> None:
    """The patient said no; the chair passes to the next person (FR-PAT-27, FR-QUE-30)."""
    with as_queue():
        offer = standby_repo.find_offer(offer_id)
        if offer is None:
            raise not_found("offer")
        with db.transaction():
            declined = standby_repo.mark_declined(offer["id"], _now())
        if not declined:
            raise AppError(
                "QUEUE_GUARD_FAILED", message="That offer has already been answered.", details={"guard": "OFFER_SETTLED"}
            )
        append_event(
            {
                "sessionId": offer["sessionId"],
                "type": "SLOT_EXPIRED",
                "payload": {"offerId": offer["id"]},
                "actor": actor,
                "clientEventId": expiry_key(offer["id"]),
            }
        )
        if offer["freedBookingId"] is None:
            return
        try:
            offer_freed_slot(
                session_id=offer["sessionId"],
                freed_booking_id=offer["freedBookingId"],
                actor={"kind": "system", "job": "standby_decline"},
            )
        except Exception as error:  # noqa: BLE001
            logger.info({"sessionId": offer["sessionId"], "err": type(error).__name__}, "declined chair not passed on")


def expire_lapsed_offers(session_id: str, actor: dict[str, Any]) -> int:
    """Records the offers whose window has closed, once, by a derived key (FR-QUE-30)."""
    with as_queue():
        state = get_state(session_id)
        lapsed = rules.lapsed_offers(state, _now_ts())
        if not lapsed:
            return 0
        for offer in lapsed:
            try:
                append_event(
                    {
                        "sessionId": session_id,
                        "type": "SLOT_EXPIRED",
                        "payload": {"offerId": offer["offerId"]},
                        "actor": actor,
                        "clientEventId": expiry_key(offer["offerId"]),
                    }
                )
            except Exception as error:  # noqa: BLE001
                logger.warn(
                    {"sessionId": session_id, "offerId": offer["offerId"], "err": type(error).__name__},
                    "could not expire offer",
                )
        return len(lapsed)


def expiry_key(offer_id: str) -> str:
    """A UUIDv5 of the offer: two noticers of one lapse write one event."""
    return str(uuid.uuid5(EXPIRY_NAMESPACE, offer_id))


def require_offer(offer_id: str) -> dict[str, Any]:
    offer = standby_repo.find_offer(offer_id)
    if offer is None:
        raise not_found("offer")
    return offer


def standby_for(session_id: str) -> dict[str, Any]:
    return {"waiting": standby_repo.list_standby(session_id), "offers": standby_repo.list_offers(session_id)}


def _apply_one(session: dict[str, Any], state: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    """Validate, append, reduce: one input into one recorded fact."""
    queue_rules = session_repo.queue_rules_for(session["hospitalId"])
    payload = (
        {**data["payload"], "reinsertAfter": queue_rules["lateReinsertAfter"]}
        if data["type"] == "PATIENT_LATE"
        else data["payload"]
    )
    _assert_allowed(state, {**data, "payload": payload}, session, queue_rules)
    client_ts = data.get("clientTs")
    event = event_repo.append(
        {
            "sessionId": data["sessionId"],
            "type": data["type"],
            "payload": payload,
            "actor": data["actor"],
            "clientEventId": data.get("clientEventId"),
            "clientTs": None if client_ts is None else client_ts,
        }
    )
    if event["type"] == "ACTION_UNDONE":
        event_repo.mark_undone(event["payload"]["undoneEventId"], event["id"])
        seed = _seed_for(session)
        return {"event": event, "state": replay(seed, event_repo.list_for_session(session["id"], 0))}
    return {"event": event, "state": continue_replay(state, [event])}


def _settle(tell: Tell, session: dict[str, Any], state: dict[str, Any], events: list[dict[str, Any]]) -> dict[str, Any]:
    """Persist, recalculate, register the broadcast, queue the messages."""
    last = events[-1]
    _persist(session, state, last["serverTs"])
    etas = compute_etas(state, last["serverTs"])
    applied = [
        {"clientEventId": e["clientEventId"], "seq": e["seq"], "eventId": e["id"]}
        for e in events
        if e["clientEventId"] is not None
    ]

    def say() -> None:
        emit.queue_updated(session["id"], {"state": state, "etas": etas}, last["seq"], last["serverTs"], applied)
        for event in events:
            _broadcast_specific(session["id"], state, event)

    tell.append(say)

    material = [e for e in events if is_material_event(e["type"])]
    from_events = [
        *(p for e in material for p in notifications.plan_for(state, e, lambda booking_id: _eta_text_for(etas, booking_id))),
        *notifications.plan_two_away(state),
    ]
    plan = [
        *from_events,
        *notifications.plan_earlier(
            state,
            etas,
            notification_repo.told_etas(session["id"]),
            from_datetime(session["plannedStart"]),
            from_events,
        ),
    ]
    batch = notifications.queue_for(session["id"], plan)
    notification_repo.set_told_etas(notifications.times_told(plan))
    return {
        "result": {"state": state, "etas": etas, "seq": last["seq"], "duplicate": False, "serverTs": last["serverTs"]},
        "batch": batch,
    }


def _eta_text_for(etas: list[dict[str, Any]], booking_id: str) -> str | None:
    eta = next((e for e in etas if e["bookingId"] == booking_id), None)
    if eta is None or eta["confidence"] == "unknown":
        return None
    return eta["etaAt"]


def find_replay(client_event_id: str | None, session_id: str) -> dict[str, Any] | None:
    """The stored result of an event already applied (FR-QUE-51, SY-02)."""
    with as_queue():
        if client_event_id is None:
            return None
        stored = event_repo.find_by_client_event_id(client_event_id)
        if stored is None:
            return None
        if stored["sessionId"] != session_id:
            raise AppError("IDEMPOTENCY_KEY_REUSED")
        state = get_state(stored["sessionId"])
        return {
            "state": state,
            "etas": compute_etas(state, _now_ts()),
            "seq": stored["seq"],
            "duplicate": True,
            "serverTs": stored["serverTs"],
        }


def _lock_session(session_id: str) -> dict[str, Any]:
    session = session_repo.lock_for_update(session_id)
    if session is None:
        raise not_found("session")
    return session


def derive(client_event_id: str | None, tag: str) -> str | None:
    """A second key derived from the first: `next` is two events from one tap."""
    if client_event_id is None:
        return None
    return f"{client_event_id[:14]}{tag}{client_event_id[15:]}"


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


def get_state(session_id: str) -> dict[str, Any]:
    """The queue, replayed from the log (the cache is counts only; DB-P1)."""
    with as_queue():
        session = session_repo.find_by_id(session_id)
        if session is None:
            raise not_found("session")
        seed = _seed_for(session)
        cached = state_repo.find(session_id)
        start = 0 if cached is None else cached["rebuiltFromSeq"]
        events = event_repo.list_for_session(session_id, start)
        if start == 0:
            return replay(seed, events)
        return replay(seed, event_repo.list_for_session(session_id, 0))


def get_cached_state(session_id: str) -> dict[str, Any] | None:
    with as_queue():
        return state_repo.find(session_id)


def rebuild(session_id: str) -> dict[str, Any]:
    """Full replay from the log, rewriting the cache (BACKEND.md §4.2)."""

    def body(tell: Tell) -> dict[str, Any]:
        session = session_repo.lock_for_update(session_id)
        if session is None:
            raise not_found("session")
        state = replay(_seed_for(session), event_repo.list_for_session(session_id, 0))
        state_repo.clear(session_id)
        _persist(session, state, _now_ts())
        return state

    return _committed(body)


def get_etas(session_id: str) -> list[dict[str, Any]]:
    with as_queue():
        return compute_etas(get_state(session_id), _now_ts())


def _seed_for(session: dict[str, Any]) -> dict[str, Any]:
    return {
        "plan": {
            "sessionId": session["id"],
            "doctorId": session["doctorId"],
            "plannedStart": from_datetime(session["plannedStart"]),
            "plannedEnd": from_datetime(session["plannedEnd"]),
            "capacity": session["capacity"],
            "defaultConsultSeconds": session["defaultConsultMinutes"] * 60,
        },
        "roster": booking_repo.roster_for(session["id"]),
    }


def _load_state(session: dict[str, Any]) -> dict[str, Any]:
    seed = _seed_for(session)
    events = event_repo.list_for_session(session["id"], 0)
    return empty_state(seed) if not events else replay(seed, events)


def _persist(session: dict[str, Any], state: dict[str, Any], at: str) -> None:
    """Writes every derived row from the reducer's state; decides nothing."""
    projection = project(state)
    state_repo.save(projection, None if state["status"] == "ended" else projected_end(state, at))
    session_repo.save_projection(
        session["id"],
        {
            "status": state["status"],
            "actualStart": state["doctorArrivedAt"],
            "actualEnd": state["endedAt"],
            "delayMinutes": state["delayMinutes"],
            "avgConsultSeconds": projection["avgConsultSeconds"],
            "lastEventSeq": state["lastSeq"],
        },
    )
    booking_repo.save_projections(
        [
            {
                "bookingId": entry["bookingId"],
                "status": entry["status"],
                "calledAt": entry["calledAt"],
                "doneAt": entry["doneAt"],
                "arrivedAt": entry["arrivedAt"],
                "quotedWaitMinutes": entry["quotedWaitMinutes"],
                "consultSeconds": entry["consultSeconds"],
                "cancelledReason": None if entry["cancelled"] is None else entry["cancelled"]["reason"],
            }
            for entry in state["entries"]
        ]
    )


def _broadcast_specific(session_id: str, state: dict[str, Any], event: dict[str, Any]) -> None:
    if event["type"] == "DELAY_DECLARED":
        emit.session_delayed(
            session_id,
            {
                "minutes": event["payload"]["minutes"],
                "totalDelayMinutes": state["delayMinutes"],
                "reason": event["payload"]["reason"],
            },
            event["seq"],
            event["serverTs"],
        )
    elif event["type"] == "PATIENT_CALLED":
        entry = find_entry(state, event["payload"]["bookingId"])
        if entry is not None:
            emit.patient_called(
                entry["patientId"],
                {"sessionId": session_id, "bookingId": entry["bookingId"], "serial": entry["serial"]},
                event["seq"],
                event["serverTs"],
            )
    elif event["type"] == "SESSION_ENDED":
        emit.session_ended(session_id, event["seq"], event["serverTs"])


def _read_string(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str):
        raise AppError("VALIDATION_FAILED", details={"missing": key})
    return value


def _read_number(payload: dict[str, Any], key: str) -> float:
    value = payload.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise AppError("VALIDATION_FAILED", details={"missing": key})
    return value


def _assert_allowed(state: dict[str, Any], data: dict[str, Any], session: dict[str, Any], settings: dict[str, Any]) -> None:
    """The authoritative guard for this event type (BACKEND.md §4.1 step 4)."""
    now = _now_ts()
    kind = data["type"]
    payload = data["payload"]
    result: dict[str, Any] | None = None
    if kind == "DOCTOR_ARRIVED":
        result = rules.can_declare_doctor_arrived(state)
    elif kind == "DELAY_DECLARED":
        result = rules.can_declare_delay(state, _read_number(payload, "minutes"))
    elif kind == "SESSION_PAUSED":
        result = rules.can_pause(state)
    elif kind == "SESSION_RESUMED":
        result = rules.can_resume(state)
    elif kind == "PATIENT_CALLED":
        result = rules.can_call_next(state)
    elif kind == "PATIENT_DONE":
        result = rules.can_mark_done(state, _read_string(payload, "bookingId"))
    elif kind == "PATIENT_LATE":
        result = rules.can_declare_late(state, _read_string(payload, "bookingId"))
    elif kind == "PATIENT_NO_SHOW":
        result = rules.can_mark_no_show(state, _read_string(payload, "bookingId"), settings, now)
    elif kind == "PATIENT_REINSERTED":
        result = rules.can_reinstate(state, _read_string(payload, "bookingId"))
    elif kind == "PATIENT_ARRIVED":
        result = rules.can_check_in(
            state, _read_string(payload, "bookingId"), _read_number(payload, "quotedWaitMinutes")
        )
    elif kind == "WALKIN_ADDED":
        reason = payload.get("reason")
        result = rules.can_add_walkin(
            state,
            "index" if _read_string(payload, "position") == "index" else "end",
            reason if isinstance(reason, str) else None,
        )
    elif kind == "PRIORITY_REORDERED":
        result = rules.can_reorder(state, _read_string(payload, "bookingId"), _read_string(payload, "reason"))
    elif kind == "SESSION_ENDED":
        result = rules.can_end_session(state)
    if result is not None and not result["ok"]:
        raise guard_failed(result["code"], result["detail"])
    if state["status"] == "ended" and kind != "ACTION_UNDONE":
        raise guard_failed("SESSION_ENDED", f"Session {session['id']} has ended.")


def require_session(session_id: str) -> dict[str, Any]:
    session = session_repo.find_by_id(session_id)
    if session is None:
        raise not_found("session")
    return session


def require_booking(booking_id: str) -> dict[str, Any]:
    booking = booking_repo.find_by_id(booking_id)
    if booking is None:
        raise not_found("booking")
    return booking


def require_event(event_id: str) -> dict[str, Any]:
    event = event_repo.find_by_id(event_id)
    if event is None:
        raise not_found("event")
    return event


def booking_owner(booking_id: str) -> dict[str, Any] | None:
    return booking_repo.owner_of(booking_id)


def list_bookings(session_id: str) -> list[dict[str, Any]]:
    return booking_repo.list_for_session(session_id)


def applied_among(session_id: str, client_event_ids: list[str], upto_seq: int) -> list[dict[str, Any]]:
    return event_repo.applied_among(session_id, client_event_ids, upto_seq)


def append_batch(*, session_id: str, actor: dict[str, Any], entries: list[dict[str, Any]]) -> dict[str, Any]:
    """Applies a whole offline batch under one lock; a guard refusal is a conflict, not a failure (SY-03)."""

    def body(tell: Tell) -> dict[str, Any]:
        session = _lock_session(session_id)
        state = _load_state(session)
        outcomes: list[dict[str, Any]] = []
        applied: list[dict[str, Any]] = []
        for entry in entries:
            already = event_repo.find_by_client_event_id(entry["clientEventId"])
            if already is not None and already["sessionId"] != session_id:
                outcomes.append(
                    {
                        "kind": "conflict",
                        "clientEventId": entry["clientEventId"],
                        "reason": "This action id was already used for another chamber.",
                        "code": "IDEMPOTENCY_KEY_REUSED",
                    }
                )
                continue
            if already is not None:
                outcomes.append(
                    {"kind": "accepted", "clientEventId": entry["clientEventId"], "seq": already["seq"], "eventId": already["id"]}
                )
                continue
            try:
                # A savepoint per entry: a refused guard writes nothing, and
                # the batch carries on.
                with db.transaction():
                    result = _apply_one(
                        session,
                        state,
                        {
                            "sessionId": session_id,
                            "type": entry["type"],
                            "payload": entry["payload"],
                            "actor": actor,
                            "clientEventId": entry["clientEventId"],
                            "clientTs": entry.get("clientTs"),
                        },
                    )
            except AppError as error:
                if error.code != "QUEUE_GUARD_FAILED":
                    raise
                guard = (error.details or {}).get("guard")
                outcomes.append(
                    {
                        "kind": "conflict",
                        "clientEventId": entry["clientEventId"],
                        "reason": error.message,
                        "code": guard if isinstance(guard, str) else error.code,
                    }
                )
                continue
            state = result["state"]
            applied.append(result["event"])
            outcomes.append(
                {
                    "kind": "accepted",
                    "clientEventId": entry["clientEventId"],
                    "seq": result["event"]["seq"],
                    "eventId": result["event"]["id"],
                }
            )
        if not applied:
            return {
                "result": {
                    "outcomes": outcomes,
                    "state": state,
                    "etas": compute_etas(state, _now_ts()),
                    "seq": state["lastSeq"],
                    "serverTs": _now_ts(),
                },
                "batch": notifications.NOTHING,
            }
        done = _settle(tell, session, state, applied)
        return {
            "result": {
                "outcomes": outcomes,
                "state": done["result"]["state"],
                "etas": done["result"]["etas"],
                "seq": done["result"]["seq"],
                "serverTs": done["result"]["serverTs"],
            },
            "batch": done["batch"],
        }

    settled = _committed(body)
    notifications.dispatch(settled["batch"])
    return settled["result"]


def set_capacity(session_id: str, capacity: int) -> None:
    session_repo.set_capacity(session_id, capacity)


def broadcast_roster(session_id: str) -> None:
    """Re-broadcasts after the roster changed: a booking changes the seed, not the log (FR-QUE-52)."""
    with as_queue():
        state = get_state(session_id)
        etas = get_etas(session_id)
        emit.queue_updated(session_id, {"state": state, "etas": etas}, state["lastSeq"], _now_ts())


def events_since(session_id: str, after_seq: int) -> list[dict[str, Any]]:
    return event_repo.list_for_session(session_id, after_seq)


def principal_holds_booking(session_id: str, *, user_id: str | None, booking_id: str | None) -> bool:
    return booking_repo.exists_for_principal(session_id, user_id=user_id, booking_id=booking_id)


def next_serial(session_id: str) -> int:
    state = get_state(session_id)
    return max([0, *(entry["serial"] for entry in state["entries"])]) + 1


def create_walkin_booking(*, session_id: str, patient_id: str, fee_poisha: int, staff_user_id: str) -> str:
    def body(tell: Tell) -> str:
        session = session_repo.lock_for_update(session_id)
        if session is None:
            raise not_found("session")
        roster = booking_repo.roster_for(session_id)
        highest = max([0, *(b["serial"] for b in roster)])
        return booking_repo.insert_walkin(
            session_id=session_id,
            patient_id=patient_id,
            serial=highest + 1,
            fee_poisha=fee_poisha,
            created_by_staff_id=staff_user_id,
        )

    return _committed(body)


def add_walkin(
    *,
    session_id: str,
    patient_id: str,
    position: str,
    index: int | None,
    reason: str | None,
    actor: dict[str, Any],
    client_event_id: str | None,
    client_ts: str | None,
) -> dict[str, Any]:
    """Issues one walk-in under the session lock; replay is checked again inside it (FR-REC-14, FR-QUE-51)."""
    with as_queue():

        def body(tell: Tell) -> dict[str, Any]:
            session = _lock_session(session_id)
            before = _load_state(session)
            stored = None if client_event_id is None else event_repo.find_by_client_event_id(client_event_id)
            if stored is not None:
                if (
                    stored["sessionId"] != session_id
                    or stored["type"] != "WALKIN_ADDED"
                    or stored["actor"]["kind"] != "staff"
                    or stored["actor"].get("staffUserId") != actor["staffUserId"]
                ):
                    raise AppError("QUEUE_CONFLICT")
                entry = next((row for row in before["entries"] if row["bookingId"] == stored["payload"]["bookingId"]), None)
                if (
                    entry is None
                    or entry["patientId"] != patient_id
                    or stored["payload"].get("position") != position
                    or stored["payload"].get("index") != index
                    or stored["payload"].get("reason") != reason
                ):
                    raise AppError("QUEUE_CONFLICT")
                return {
                    "result": {
                        **_result(before, stored["seq"], True, stored["serverTs"]),
                        "walkin": {"bookingId": entry["bookingId"], "serial": entry["serial"]},
                    },
                    "batch": None,
                }
            guard = rules.can_add_walkin(before, position, reason)
            if not guard["ok"]:
                raise guard_failed(guard["code"], guard["detail"])
            roster = booking_repo.roster_for(session["id"])
            serial = max([0, *(b["serial"] for b in roster)]) + 1
            booking_id = booking_repo.insert_walkin(
                session_id=session["id"],
                patient_id=patient_id,
                serial=serial,
                fee_poisha=session["feePoisha"],
                created_by_staff_id=actor["staffUserId"],
            )
            with_booking = _load_state(session)
            applied = _apply_one(
                session,
                with_booking,
                {
                    "sessionId": session["id"],
                    "type": "WALKIN_ADDED",
                    "payload": {"bookingId": booking_id, "position": position, "index": index, "reason": reason},
                    "actor": actor,
                    "clientEventId": client_event_id,
                    "clientTs": client_ts,
                },
            )
            settled = _settle(tell, session, applied["state"], [applied["event"]])
            return {
                "result": {**settled["result"], "walkin": {"bookingId": booking_id, "serial": serial}},
                "batch": settled["batch"],
            }

        issued = _committed(body)
        if issued["batch"] is not None:
            notifications.dispatch(issued["batch"])
        return issued["result"]


def waiting_count(session_id: str) -> int:
    return len(waiting_queue(get_state(session_id)))
