"""What may happen to an emergency case (port of `emergency/cases.ts`; FR-ER-01..10).

Only the server's half: the guards, whether an action already happened, and
the orders the ER console lists cases in. The console's optimistic helpers
(`newestCases`, `casesAfterRead`, `applyLocalCase`) stay in the browser.
"""

from __future__ import annotations

import functools
import math
from typing import Any

from ...core.schema import js_trim
from ..time import add_minutes, parse_ms

OPEN_EMERGENCY_STATES = ("inbound", "acknowledged", "arrived", "in_treatment")
ON_THE_WAY_STATES = ("inbound", "acknowledged")
IN_ER_STATES = ("arrived", "in_treatment")
EMERGENCY_ACTIONS = ("acknowledge", "accept", "decline", "cancel", "triage", "handoff", "discharge", "admit", "refer")

ALLOWED: dict[str, Any] = {"ok": True}


def _deny(code: str, detail: str) -> dict[str, Any]:
    return {"ok": False, "code": code, "detail": detail}


def is_open(state: str) -> bool:
    return state in OPEN_EMERGENCY_STATES


def is_on_the_way(state: str) -> bool:
    return state in ON_THE_WAY_STATES


def is_in_er(state: str) -> bool:
    return state in IN_ER_STATES


def _held_by_referral(context: dict[str, Any]) -> dict[str, Any]:
    if context.get("openReferral") is True:
        return _deny("REFERRAL_OPEN", "Another ER is answering a referral of this case. Withdraw it first.")
    return ALLOWED


def can_act_on(current: dict[str, Any], action: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    context = context or {}
    state = current["state"]
    if action == "acknowledge":
        return ALLOWED if state == "inbound" else _deny("WRONG_STATE", f"A {state} case cannot be acknowledged.")
    if action == "accept":
        return ALLOWED if is_on_the_way(state) else _deny("WRONG_STATE", f"A {state} case cannot be accepted.")
    if action == "decline":
        if not is_on_the_way(state):
            return _deny("WRONG_STATE", f"A {state} case cannot be declined.")
        if js_trim(context.get("reason") or "") == "":
            return _deny("REASON_REQUIRED", "Say why the case is declined.")
        return ALLOWED
    if action == "cancel":
        return ALLOWED if is_on_the_way(state) else _deny("WRONG_STATE", f"A {state} case cannot be called off.")
    if action == "triage":
        return ALLOWED if is_in_er(state) else _deny("WRONG_STATE", "Only somebody in the ER can be triaged.")
    if action == "handoff":
        if not is_in_er(state):
            return _deny("WRONG_STATE", "Only somebody in the ER can be handed to the ward.")
        return _held_by_referral(context)
    if action == "discharge":
        if not is_in_er(state):
            return _deny("WRONG_STATE", f"A {state} case cannot be discharged.")
        return _held_by_referral(context)
    if action == "admit":
        if not is_in_er(state):
            return _deny("WRONG_STATE", f"A {state} case cannot be admitted.")
        if current["admitRequestedAt"] is None:
            return _deny("NOT_HANDED_OFF", "The ER has not handed this case to the ward.")
        return _held_by_referral(context)
    if action == "refer":
        return ALLOWED if is_in_er(state) else _deny("WRONG_STATE", f"A {state} case cannot leave for another ER.")
    raise ValueError(f"unknown emergency action {action}")


def already_applied(current: dict[str, Any], action: str, context: dict[str, Any] | None = None) -> bool:
    context = context or {}
    state = current["state"]
    if action == "acknowledge":
        return state == "acknowledged"
    if action == "accept":
        return current["arrivedAt"] is not None and current["inboundAt"] is not None
    if action == "decline":
        return state == "declined"
    if action == "cancel":
        return state == "cancelled"
    if action == "triage":
        return is_in_er(state) and current["triage"] == context.get("triage")
    if action == "handoff":
        return is_in_er(state) and current["admitBedKind"] == context.get("bedKind")
    if action == "discharge":
        return state == "discharged"
    if action == "admit":
        return state == "admitted"
    if action == "refer":
        return state == "referred"
    raise ValueError(f"unknown emergency action {action}")


def load_of(cases: list[dict[str, Any]]) -> int:
    return sum(1 for entry in cases if is_open(entry["state"]))


def _stamp(value: str | None) -> float:
    return math.inf if value is None else parse_ms(value)


def _sign(value: float) -> int:
    return (value > 0) - (value < 0)


def triage_order(cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def weight(triage: str | None) -> int:
        return 0 if triage == "red" else 1 if triage is None else 2 if triage == "yellow" else 3

    def compare(a: dict[str, Any], b: dict[str, Any]) -> int:
        by_weight = weight(a["triage"]) - weight(b["triage"])
        if by_weight:
            return by_weight
        a_at, b_at = _stamp(a["arrivedAt"]), _stamp(b["arrivedAt"])
        # JS: Infinity - Infinity is NaN, which `||` passes over.
        if not (math.isinf(a_at) and math.isinf(b_at)) and a_at != b_at:
            return _sign(a_at - b_at)
        return -1 if a["id"] < b["id"] else 1

    return sorted(cases, key=functools.cmp_to_key(compare))


def expected_arrival(current: dict[str, Any]) -> str | None:
    if current["inboundAt"] is None or current["inboundEtaMinutes"] is None:
        return None
    return add_minutes(current["inboundAt"], current["inboundEtaMinutes"])


def inbound_order(cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def compare(a: dict[str, Any], b: dict[str, Any]) -> int:
        answered = int(a["state"] != "inbound") - int(b["state"] != "inbound")
        if answered:
            return answered
        arrival_a, arrival_b = expected_arrival(a), expected_arrival(b)
        if arrival_a is not None and arrival_b is not None and arrival_a != arrival_b:
            return _sign(parse_ms(arrival_a) - parse_ms(arrival_b))
        if arrival_a is None and arrival_b is not None:
            return 1
        if arrival_b is None and arrival_a is not None:
            return -1
        a_at, b_at = _stamp(a["inboundAt"]), _stamp(b["inboundAt"])
        if not (math.isinf(a_at) and math.isinf(b_at)) and a_at != b_at:
            return _sign(a_at - b_at)
        return -1 if a["id"] < b["id"] else 1

    return sorted(cases, key=functools.cmp_to_key(compare))


def token_label(n: int) -> str:
    return f"ER-{n}"


def next_token_label(arrived_today: int, open_labels: set[str]) -> str:
    n = arrived_today + 1
    while token_label(n) in open_labels:
        n += 1
    return token_label(n)
