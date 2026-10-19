"""The referral state machine (port of `emergency/referrals.ts`; FR-EMG-07..09, APP_FLOW.md B4).

The receiving ER sees, answers and records the arrival; the sending ER can
only withdraw. The sending ER keeps the case until the arrival is recorded
(the owner's ruling of 2026-09-22). Only the server's half is here; the
consoles' optimistic `applyLocalReferral` stays in the browser.
"""

from __future__ import annotations

import functools
from typing import Any

from ...core.schema import js_trim
from ..time import parse_ms
from .cases import is_in_er
from .ranking import need_for

OPEN_REFERRAL_STATES = ("sent", "seen", "accepted")
REFERRAL_ACTIONS = ("seen", "accept", "decline", "cancel", "arrive")
REFERRAL_NOTE_MAX = 500

_SIDE_OF_ACTION = {"seen": "receiver", "accept": "receiver", "decline": "receiver", "arrive": "receiver", "cancel": "sender"}

ALLOWED: dict[str, Any] = {"ok": True}


def _deny(code: str, detail: str) -> dict[str, Any]:
    return {"ok": False, "code": code, "detail": detail}


def is_open_referral(state: str) -> bool:
    return state in OPEN_REFERRAL_STATES


def side_of(referral: dict[str, Any], hospital_id: str) -> str | None:
    if referral["from"]["hospitalId"] == hospital_id:
        return "sender"
    if referral["to"]["hospitalId"] == hospital_id:
        return "receiver"
    return None


def can_act_on_referral(
    current: dict[str, Any], action: str, side: str, context: dict[str, Any] | None = None
) -> dict[str, Any]:
    context = context or {}
    if _SIDE_OF_ACTION[action] != side:
        return _deny(
            "WRONG_SIDE",
            "Only the ER that sent a referral can withdraw it."
            if action == "cancel"
            else "Only the ER a referral was sent to can answer it.",
        )
    state = current["state"]
    if action == "seen":
        return ALLOWED if state == "sent" else _deny("WRONG_STATE", f"A {state} referral cannot be marked seen.")
    if action == "accept":
        return ALLOWED if state in ("sent", "seen") else _deny("WRONG_STATE", f"A {state} referral cannot be accepted.")
    if action == "decline":
        if state not in ("sent", "seen"):
            return _deny("WRONG_STATE", f"A {state} referral cannot be declined.")
        if js_trim(context.get("reason") or "") == "":
            return _deny("REASON_REQUIRED", "Say why the referral is declined.")
        return ALLOWED
    if action == "cancel":
        return ALLOWED if is_open_referral(state) else _deny("WRONG_STATE", f"A {state} referral cannot be withdrawn.")
    if action == "arrive":
        return ALLOWED if state == "accepted" else _deny("WRONG_STATE", "Only an accepted referral can arrive.")
    raise ValueError(f"unknown referral action {action}")


def referral_already_applied(current: dict[str, Any], action: str) -> bool:
    if action == "seen":
        return current["seenAt"] is not None
    if action == "accept":
        return current["state"] in ("accepted", "arrived")
    if action == "decline":
        return current["state"] == "declined"
    if action == "cancel":
        return current["state"] == "cancelled"
    if action == "arrive":
        return current["state"] == "arrived"
    raise ValueError(f"unknown referral action {action}")


def referral_timeline(referral: dict[str, Any]) -> list[dict[str, str]]:
    steps = [{"step": "sent", "at": referral["sentAt"]}]
    if referral["seenAt"] is not None:
        steps.append({"step": "seen", "at": referral["seenAt"]})
    if referral["respondedAt"] is not None:
        steps.append(
            {"step": "declined" if referral["state"] == "declined" else "accepted", "at": referral["respondedAt"]}
        )
    if referral["arrivedAt"] is not None:
        steps.append({"step": "arrived", "at": referral["arrivedAt"]})
    if referral["state"] == "cancelled" and referral["closedAt"] is not None:
        steps.append({"step": "cancelled", "at": referral["closedAt"]})
    return steps


def can_refer(current: dict[str, Any], open_referral: bool) -> dict[str, Any]:
    if not is_in_er(current["state"]):
        return _deny("WRONG_STATE", "Only somebody in the ER can be referred.")
    if open_referral:
        return _deny("REFERRAL_OPEN", "This case already has a referral waiting. Withdraw it first.")
    return ALLOWED


def default_need(problem: str) -> dict[str, str | None]:
    return need_for(problem)


def asks_for_something(need: dict[str, Any]) -> bool:
    return need["capability"] is not None or need["bedKind"] is not None


def referral_candidates(results: list[dict[str, Any]]) -> dict[str, Any]:
    without_capability = 0
    without_beds = 0
    candidates: list[dict[str, Any]] = []
    for result in results:
        if result["hasCapability"] is False:
            without_capability += 1
        elif result["freeBeds"] is None or result["freeBeds"] <= 0:
            without_beds += 1
        else:
            candidates.append(result)
    return {"candidates": candidates, "withoutCapability": without_capability, "withoutBeds": without_beds}


def incoming_order(referrals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def compare(a: dict[str, Any], b: dict[str, Any]) -> int:
        answered = int(a["state"] == "accepted") - int(b["state"] == "accepted")
        if answered:
            return answered
        by_time = parse_ms(a["sentAt"]) - parse_ms(b["sentAt"])
        if by_time:
            return (by_time > 0) - (by_time < 0)
        return -1 if a["id"] < b["id"] else 1

    return sorted(referrals, key=functools.cmp_to_key(compare))
