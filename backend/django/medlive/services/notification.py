"""What a queue event tells whom, and the outbox it is written to
(port of `services/notification.service.ts`; FR-NOT-*, FR-QUE-15, FR-QUE-42).

Planning is pure (`plan_for`, `plan_two_away`, `plan_earlier`); writing the
outbox happens inside the caller's transaction (`queue_for` and the
`queue_*` writers), and sending happens after the commit (`dispatch`).
"""

from __future__ import annotations

import math
import re
import threading
from datetime import datetime, timezone
from typing import Any, Callable, Mapping

from ..adapters.sms import segments_for, sms
from ..core.scope import SYSTEM, db_scope
from ..domain.messaging import end_of_quiet_hours, in_quiet_hours
from ..domain.queue.eta import earlier_than_told, two_away_bookings
from ..domain.queue.state import waiting_queue
from ..domain.time import from_datetime, parse_ms
from ..i18n import (
    BED_KIND_NAMES,
    bed_kind_name,
    format_clock,
    format_number,
    format_serial,
    render,
    tp,
)
from ..repositories import notification as notification_repo
from . import notification_sender as sender
from .links import LINK_PARAMS, origin_of

TEMPLATE_FOR = {
    "DOCTOR_ARRIVED": "queue.doctor_arrived",
    "DELAY_DECLARED": "queue.delayed",
    "PATIENT_CALLED": "queue.called",
    "PATIENT_NO_SHOW": "queue.no_show",
    "BOOKING_CANCELLED": "queue.cancelled",
    "SESSION_ENDED": "session.ended",
}

PAYMENT_RELEASED_REASON = "অনলাইন পেমেন্ট সময়মতো হয়নি — সিরিয়াল ছেড়ে দেওয়া হয়েছে"

ALWAYS_OVERRIDES_QUIET_HOURS = {"queue", "booking", "session", "emergency", "bed", "payment"}

SEND_ONCE = {"queue.two_away"}
TELLS_A_TIME = {"queue.doctor_arrived", "queue.delayed", "queue.earlier"}
CREDENTIAL_PARAMS = {"link"}

BODY_RETENTION_DAYS = 90
CORRELATION_PARAMS = ("bookingId", "bedRequestId", "emergencyCaseId", "testOrderId")
PURGE_BATCH = 2_000
RECEIPT_REASON_MAX = 80

NOTHING: dict[str, list[Any]] = {"ids": [], "messages": []}


def _iso(at: datetime) -> str:
    return from_datetime(at)


def within_quiet_hours(key: str, at: datetime) -> bool:
    namespace = key.split(".")[0]
    if namespace in ALWAYS_OVERRIDES_QUIET_HOURS:
        return False
    return in_quiet_hours(_iso(at))


# --- Planning ------------------------------------------------------------------


def plan_for(state: dict[str, Any], event: dict[str, Any], eta_for: Callable[[str], str | None]) -> list[dict[str, Any]]:
    key = TEMPLATE_FOR.get(event["type"])
    if key is None:
        return []
    kind = event["type"]
    if kind in ("PATIENT_CALLED", "PATIENT_NO_SHOW", "BOOKING_CANCELLED"):
        booking_id = str(event["payload"]["bookingId"])
        released = kind == "BOOKING_CANCELLED" and event["payload"].get("reason") == PAYMENT_RELEASED_REASON
        return [{"bookingId": booking_id, "templateKey": "payment.released" if released else key, "params": {}}]
    minutes = (
        _js_string(event["payload"]["minutes"]) if kind == "DELAY_DECLARED" else _js_string(state["delayMinutes"])
    )
    return [
        {
            "bookingId": entry["bookingId"],
            "templateKey": key,
            "params": {"minutes": minutes, "eta": eta_for(entry["bookingId"]) or ""},
        }
        for entry in waiting_queue(state)
    ]


def _js_string(value: Any) -> str:
    from ..domain.jsfmt import js_str

    return js_str(value)


def plan_two_away(state: dict[str, Any]) -> list[dict[str, Any]]:
    if state["doctorArrivedAt"] is None or state["status"] == "ended":
        return []
    return [{"bookingId": booking_id, "templateKey": "queue.two_away", "params": {}} for booking_id in two_away_bookings(state)]


def times_told(plan: list[dict[str, Any]]) -> list[dict[str, str]]:
    told: dict[str, str] = {}
    for planned in plan:
        eta = planned["params"].get("eta")
        if planned["templateKey"] in TELLS_A_TIME and eta is not None and eta != "":
            told[planned["bookingId"]] = eta
    return [{"bookingId": booking_id, "etaAt": eta_at} for booking_id, eta_at in told.items()]


def plan_earlier(
    state: dict[str, Any],
    etas: list[dict[str, Any]],
    told: Mapping[str, datetime],
    planned_start: str,
    already_in_plan: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    just_told = {entry["bookingId"] for entry in times_told(already_in_plan)}
    told_at = {booking_id: _iso(at) for booking_id, at in told.items()}
    return [
        {"bookingId": eta["bookingId"], "templateKey": "queue.earlier", "params": {"eta": eta["etaAt"]}}
        for eta in earlier_than_told(state, etas, told_at, planned_start)
        if eta["bookingId"] not in just_told
    ]


def plan_booking_confirmed(booking_id: str, link: str | None, held_minutes: int | None = None) -> list[dict[str, Any]]:
    link_params: dict[str, str] = {} if link is None else {"link": link, LINK_PARAMS["kind"]: "booking"}
    if held_minutes is None:
        return [{"bookingId": booking_id, "templateKey": "booking.confirmed", "params": link_params}]
    return [
        {"bookingId": booking_id, "templateKey": "booking.held", "params": {**link_params, "minutes": str(held_minutes)}}
    ]


def merge(*batches: dict[str, list[Any]]) -> dict[str, list[Any]]:
    return {
        "ids": [i for batch in batches for i in batch["ids"]],
        "messages": [m for batch in batches for m in batch["messages"]],
    }


# --- The outbox ------------------------------------------------------------------


def for_the_record(template: str, params: Mapping[str, str]) -> dict[str, Any]:
    """What is kept of a message: its words, without any credential in them."""
    kept: dict[str, str] = {}
    shown: dict[str, str] = {}
    for name, value in params.items():
        if name not in CREDENTIAL_PARAMS:
            kept[name] = value
            shown[name] = value
        elif value == "":
            shown[name] = value
    return {"params": kept, "body": render(template, shown)}


def _with_link_origin(params: Mapping[str, str]) -> Mapping[str, str]:
    link = params.get("link")
    if link is None or link == "":
        return params
    origin = origin_of(link)
    return params if origin is None else {**params, LINK_PARAMS["base"]: origin}


def _write_outbox(drafts: list[dict[str, Any]]) -> dict[str, list[Any]]:
    ids = notification_repo.queue_all(
        [
            {
                "recipient": draft["recipient"],
                "channel": draft["channel"],
                "templateKey": draft["templateKey"],
                **for_the_record(draft["template"], _with_link_origin(draft["params"])),
                "skipped": draft["skipped"],
                "heldUntil": draft.get("heldUntil") if draft["skipped"] is None else None,
            }
            for draft in drafts
        ]
    )
    messages = []
    for index, notification_id in enumerate(ids):
        draft = drafts[index]
        if draft["skipped"] is not None:
            continue
        if draft.get("heldUntil") is not None:
            continue
        messages.append(
            {
                "id": notification_id,
                "channel": draft["channel"],
                "to": draft["recipient"].get("phone") if draft["channel"] == "sms" else None,
                "body": render(draft["template"], draft["params"]),
                "templateKey": draft["templateKey"],
                "recipient": draft["recipient"],
            }
        )
    return {"ids": ids, "messages": messages}


def _suppression(*, channel: str, phone: str | None, template_key: str, at: datetime, budget_left: float) -> dict[str, Any]:
    if channel == "sms":
        if phone is None:
            return {"skipped": "no_phone_number", "heldUntil": None}
        if budget_left <= 0:
            return {"skipped": "sms_budget_exhausted", "heldUntil": None}
    if within_quiet_hours(template_key, at):
        until = end_of_quiet_hours(_iso(at))
        return {"skipped": None, "heldUntil": datetime.fromtimestamp(parse_ms(until) / 1000, tz=timezone.utc)}
    return {"skipped": None, "heldUntil": None}


def _channels(recipient: dict[str, Any]) -> list[str]:
    return ["push", "sms"] if notification_repo.device_tokens_for(recipient) else ["sms"]


def _now() -> datetime:
    from ..domain.time import utc_now

    return utc_now()


def queue_for(session_id: str, plan: list[dict[str, Any]], at: datetime | None = None) -> dict[str, list[Any]]:
    """Writes the planned messages for one chamber into the outbox."""
    at = at or _now()
    if not plan:
        return NOTHING
    chamber = notification_repo.chamber_for(session_id)
    recipients = notification_repo.recipients_for_session(session_id)
    templates = _template_index()
    if chamber is None:
        return NOTHING
    by_booking = {r["bookingId"]: r for r in recipients}
    already_told: dict[str, set[str]] = {}
    for key in {p["templateKey"] for p in plan if p["templateKey"] in SEND_ONCE}:
        already_told[key] = notification_repo.already_notified(session_id, key)
    sms_used = 0 if chamber["smsBudgetMonthly"] is None else notification_repo.sms_sent_this_month(chamber["hospitalId"])
    budget_left = math.inf if chamber["smsBudgetMonthly"] is None else chamber["smsBudgetMonthly"] - sms_used

    drafts: list[dict[str, Any]] = []
    for planned in plan:
        recipient = by_booking.get(planned["bookingId"])
        if recipient is None:
            continue
        if planned["bookingId"] in already_told.get(planned["templateKey"], set()):
            continue
        locale = "en" if recipient["locale"] == "en" else "bn"
        params = _params_for(planned, recipient, chamber, locale)
        for channel in _channels(recipient):
            template = templates.get(f"{planned['templateKey']}|{channel}|{locale}")
            if template is None:
                continue
            decided = _suppression(
                channel=channel, phone=recipient["phone"], template_key=planned["templateKey"], at=at, budget_left=budget_left
            )
            if decided["skipped"] is None and channel == "sms":
                budget_left -= 1
            drafts.append(
                {
                    "recipient": recipient,
                    "channel": channel,
                    "templateKey": planned["templateKey"],
                    "template": template,
                    "params": params,
                    **decided,
                }
            )
    return _write_outbox(drafts)


def queue_slot_offer(
    *,
    session_id: str,
    patient_id: str,
    phone: str,
    expires_at: str,
    link: str | None = None,
    standby: dict[str, str] | None = None,
    at: datetime | None = None,
) -> dict[str, list[Any]]:
    def params(numerals: str) -> dict[str, str]:
        out = {"time": format_clock(expires_at, numerals)}
        if link is not None:
            out.update({"link": link, **_standby_link_params(standby)})
        return out

    return _queue_standby_message(
        session_id=session_id,
        patient_id=patient_id,
        phone=phone,
        template_key="queue.slot_offered" if link is None else "queue.slot_offered_link",
        params=params,
        at=at or _now(),
    )


def queue_slot_seated(
    *, session_id: str, patient_id: str, phone: str, serial: int, link: str, standby: dict[str, str], at: datetime | None = None
) -> dict[str, list[Any]]:
    return _queue_standby_message(
        session_id=session_id,
        patient_id=patient_id,
        phone=phone,
        template_key="queue.slot_seated",
        params=lambda numerals: {"serial": format_serial(serial, numerals), "link": link, **_standby_link_params(standby)},
        at=at or _now(),
    )


def _standby_link_params(standby: dict[str, str] | None) -> dict[str, str]:
    if standby is None:
        return {}
    return {
        LINK_PARAMS["kind"]: "standby",
        LINK_PARAMS["standbyId"]: standby["id"],
        LINK_PARAMS["subject"]: standby["subject"],
    }


def _queue_standby_message(
    *, session_id: str, patient_id: str, phone: str, template_key: str, params: Callable[[str], dict[str, str]], at: datetime
) -> dict[str, list[Any]]:
    chamber = notification_repo.chamber_for(session_id)
    templates = _template_index()
    if chamber is None:
        return NOTHING
    recipient = {"patientId": patient_id, "guestId": None, "userId": None, "phone": phone, "locale": "bn"}
    filled = {"doctor": chamber["doctorNameBn"], "hospital": chamber["hospitalNameBn"], **params("bengali")}
    budget_left = (
        math.inf
        if chamber["smsBudgetMonthly"] is None
        else chamber["smsBudgetMonthly"] - notification_repo.sms_sent_this_month(chamber["hospitalId"])
    )
    drafts = []
    for channel in _channels(recipient):
        template = templates.get(f"{template_key}|{channel}|bn")
        if template is None:
            continue
        drafts.append(
            {
                "recipient": recipient,
                "channel": channel,
                "templateKey": template_key,
                "template": template,
                "params": filled,
                **_suppression(channel=channel, phone=phone, template_key=template_key, at=at, budget_left=budget_left),
            }
        )
    return _write_outbox(drafts)


def _queue_to_target(
    target: dict[str, Any] | None,
    template_key: str,
    params: Callable[[str, str], dict[str, str]],
    at: datetime,
    *,
    budgeted: bool = True,
) -> dict[str, list[Any]]:
    if target is None:
        return NOTHING
    templates = _template_index()
    recipient = target["recipient"]
    locale = "en" if recipient["locale"] == "en" else "bn"
    numerals = "bengali" if locale == "bn" else "latin"
    filled = params(locale, numerals)
    if budgeted and target.get("smsBudgetMonthly") is not None:
        budget_left: float = target["smsBudgetMonthly"] - notification_repo.sms_sent_this_month(target["hospitalId"])
    else:
        budget_left = math.inf
    drafts = []
    for channel in _channels(recipient):
        template = templates.get(f"{template_key}|{channel}|{locale}")
        if template is None:
            continue
        drafts.append(
            {
                "recipient": recipient,
                "channel": channel,
                "templateKey": template_key,
                "template": template,
                "params": filled,
                **_suppression(
                    channel=channel, phone=recipient["phone"], template_key=template_key, at=at, budget_left=budget_left
                ),
            }
        )
    return _write_outbox(drafts)


def queue_bed_request_answer(
    *, request_id: str, outcome: str, hold_expires_at: str | None, link: str, subject: str, at: datetime | None = None
) -> dict[str, list[Any]]:
    target = notification_repo.bed_request_recipient(request_id)

    def params(locale: str, numerals: str) -> dict[str, str]:
        assert target is not None
        kind = target["bedKind"]
        return {
            "bedRequestId": request_id,
            "hospital": target["hospitalNameBn"] if locale == "bn" else target["hospitalNameEn"],
            "kind": bed_kind_name(kind, locale) if kind in BED_KIND_NAMES else kind,
            "time": "" if hold_expires_at is None else format_clock(hold_expires_at, numerals),
            "link": link,
            LINK_PARAMS["kind"]: "bed_request",
            LINK_PARAMS["subject"]: subject,
        }

    return _queue_to_target(
        target, "bed.request_held" if outcome == "held" else "bed.request_declined", params, at or _now()
    )


def queue_emergency_answer(*, case_id: str, outcome: str, link: str, at: datetime | None = None) -> dict[str, list[Any]]:
    target = notification_repo.emergency_recipient(case_id)

    def params(locale: str, numerals: str) -> dict[str, str]:
        assert target is not None
        return {
            "emergencyCaseId": case_id,
            "hospital": target["hospitalNameBn"] if locale == "bn" else target["hospitalNameEn"],
            "link": link,
            LINK_PARAMS["kind"]: "emergency_case",
        }

    return _queue_to_target(
        target,
        "emergency.acknowledged" if outcome == "acknowledged" else "emergency.declined",
        params,
        at or _now(),
        budgeted=False,
    )


def queue_report_ready(*, test_order_id: str, link: str, at: datetime | None = None) -> dict[str, list[Any]]:
    target = notification_repo.report_recipient(test_order_id)

    def params(locale: str, numerals: str) -> dict[str, str]:
        assert target is not None
        return {
            "testOrderId": test_order_id,
            "test": target["testName"],
            "hospital": target["hospitalNameBn"] if locale == "bn" else target["hospitalNameEn"],
            "link": link,
            LINK_PARAMS["kind"]: "records",
        }

    return _queue_to_target(target, "lab.report_ready", params, at or _now())


# --- Sending -------------------------------------------------------------------------


def dispatch(batch: dict[str, list[Any]]) -> None:
    sender.hand(batch["messages"])


def settled(timeout: float = 30.0) -> bool:
    return sender.idle(timeout)


def verify_receipt_signature(raw_body: str, signature: str | None) -> bool:
    return bool(sms().verify_receipt(raw_body, signature))


def apply_delivery_receipt(body: Any) -> dict[str, bool]:
    receipt = sms().read_receipt(body)
    if receipt is None:
        return {"recognised": False, "applied": False}
    if receipt["outcome"] == "pending":
        return {"recognised": True, "applied": False}
    reason = re.sub(r"[^\x20-\x7E]", "", receipt["reason"] or "no_reason_given")[:RECEIPT_REASON_MAX]
    with db_scope(SYSTEM):
        applied = notification_repo.apply_receipt(
            receipt["providerRef"], receipt["outcome"], f"undelivered:{reason or 'no_reason_given'}"
        )
    return {"recognised": True, "applied": applied}


def month_of_messages(hospital_id: str) -> dict[str, Any]:
    from ..domain.time import now_iso

    return {
        **notification_repo.month_of_messages(hospital_id),
        "reportsDelivery": getattr(sms(), "reports_delivery", False) is True,
        "asOf": now_iso(),
    }


def clear_expired_bodies() -> int:
    cleared = 0
    while True:
        batch = notification_repo.clear_bodies_older_than(BODY_RETENTION_DAYS, list(CORRELATION_PARAMS), PURGE_BATCH)
        cleared += batch
        if batch < PURGE_BATCH:
            return cleared


def _params_for(planned: dict[str, Any], recipient: dict[str, Any], chamber: dict[str, Any], locale: str) -> dict[str, str]:
    numerals = "bengali" if locale == "bn" else "latin"
    minutes = planned["params"].get("minutes")
    eta = planned["params"].get("eta")
    out = {
        "bookingId": recipient["bookingId"],
        "serial": format_serial(recipient["serial"], numerals),
        "doctor": chamber["doctorNameBn"] if locale == "bn" else chamber["doctorNameEn"],
        "hospital": chamber["hospitalNameBn"] if locale == "bn" else chamber["hospitalNameEn"],
        "room": chamber["room"] if chamber["room"] is not None else ("ডাক্তারের কক্ষ" if locale == "bn" else "the chamber"),
        "time": format_clock(chamber["plannedStart"], numerals),
        "date": chamber["sessionDate"],
        "minutes": "" if minutes is None or minutes == "" else format_number(float(minutes), numerals),
        "eta": tp("etaUnknown", locale) if eta is None or eta == "" else format_clock(eta, numerals),
        "link": planned["params"].get("link", ""),
    }
    if planned["params"].get(LINK_PARAMS["kind"]) is not None:
        out[LINK_PARAMS["kind"]] = planned["params"][LINK_PARAMS["kind"]]
    return out


_cache_lock = threading.Lock()
_cache: dict[str, str] | None = None


def _template_index() -> dict[str, str]:
    global _cache
    with _cache_lock:
        if _cache is not None:
            return _cache
    rows = notification_repo.active_templates()
    index = {f"{r['key']}|{r['channel']}|{r['locale']}": r["body"] for r in rows}
    with _cache_lock:
        _cache = index
    return index


def forget_templates() -> None:
    global _cache
    with _cache_lock:
        _cache = None


def segments_of(body: str) -> int:
    return segments_for(body)
