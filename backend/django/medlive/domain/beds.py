"""The ward board's rules and the capacity it publishes (port of `beds/board.ts` and `beds/capacity.ts`; FR-BED-01..09).

Only the server's half is here: what may happen to a bed, what it becomes,
and the figures counted from the board. The console's optimistic helpers
(`newestBeds`, `boardAfterRead`, `applyLocal`) stay in the browser.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from ..core.schema import js_trim
from .time import parse_ms

BED_EVENT_TYPES = ("ADMIT", "DISCHARGE", "TRANSFER", "RESERVE", "RELEASE", "CLEAN_START", "CLEAN_DONE", "OOS", "RESTORE")
BED_ACTIONS = ("admit", "discharge", "transfer", "reserve", "release", "clean_start", "clean_done", "oos", "restore")
ADMISSION_SOURCES = ("er", "opd", "app_request", "referral")
HOLD_MINUTE_CHOICES = (30, 60, 120, 240)
MAX_HOLD_MINUTES = 240

ALLOWED: dict[str, Any] = {"ok": True}


def _deny(code: str, detail: str) -> dict[str, Any]:
    return {"ok": False, "code": code, "detail": detail}


def hold_lapsed(bed: dict[str, Any], now: str) -> bool:
    return bed["state"] == "reserved" and bed["reservedUntil"] is not None and parse_ms(bed["reservedUntil"]) <= parse_ms(now)


def effective_state(bed: dict[str, Any], now: str) -> str:
    return "free" if hold_lapsed(bed, now) else bed["state"]


def can_apply(bed: dict[str, Any], action: str, now: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    context = context or {}
    state = effective_state(bed, now)
    if action == "admit":
        if state == "free":
            return ALLOWED
        if state == "reserved":
            if bed["heldForRequestId"] is None:
                return ALLOWED
            if bed["heldForRequestId"] == context.get("bedRequestId"):
                return ALLOWED
            return _deny("HELD_FOR_SOMEONE_ELSE", "This bed is held for another request.")
        return _deny("WRONG_STATE", f"A {state} bed cannot be admitted into.")
    if action in ("discharge", "transfer"):
        if state == "occupied":
            return ALLOWED
        return _deny("NOT_OCCUPIED", "Only an occupied bed has somebody to discharge or move.")
    if action == "reserve":
        if state != "free":
            return _deny("WRONG_STATE", f"A {state} bed cannot be reserved.")
        minutes = context.get("holdMinutes")
        if minutes is None or minutes <= 0 or minutes > MAX_HOLD_MINUTES:
            return _deny("HOLD_OUT_OF_RANGE", f"A hold is between 1 and {MAX_HOLD_MINUTES} minutes.")
        return ALLOWED
    if action == "release":
        return ALLOWED if state == "reserved" else _deny("WRONG_STATE", "That bed is not reserved.")
    if action == "clean_start":
        return ALLOWED if state == "free" else _deny("WRONG_STATE", "Only a free bed can be sent for cleaning.")
    if action == "clean_done":
        return ALLOWED if state == "cleaning" else _deny("WRONG_STATE", "That bed is not being cleaned.")
    if action == "oos":
        if state not in ("free", "cleaning"):
            return _deny("WRONG_STATE", f"A {state} bed cannot be taken out of service.")
        if js_trim(context.get("reason") or "") == "":
            return _deny("REASON_REQUIRED", "Say why the bed is out of service.")
        return ALLOWED
    if action == "restore":
        return ALLOWED if state == "out_of_service" else _deny("WRONG_STATE", "That bed is not out of service.")
    raise ValueError(f"unknown bed action {action}")


def can_receive_transfer(source: dict[str, Any], target: dict[str, Any], now: str) -> dict[str, Any]:
    if source["id"] == target["id"]:
        return _deny("SAME_BED", "A patient cannot be moved to the bed they are in.")
    state = effective_state(target, now)
    if state == "free":
        return ALLOWED
    if state == "reserved" and target["heldForRequestId"] is None:
        return ALLOWED
    return _deny("WRONG_STATE", f"A {state} bed cannot receive a transfer.")


def can_forecast_discharge(bed: dict[str, Any], date: str | None, today: str) -> dict[str, Any]:
    if bed["state"] != "occupied":
        return _deny("NOT_OCCUPIED", "Only an occupied bed has a discharge to forecast.")
    if date is not None and date < today:
        return _deny("DISCHARGE_DATE_PAST", "An expected discharge cannot be in the past.")
    return ALLOWED


_OUTCOMES = {
    "admit": ("ADMIT", "occupied"),
    "discharge": ("DISCHARGE", "cleaning"),
    "transfer": ("TRANSFER", "cleaning"),
    "reserve": ("RESERVE", "reserved"),
    "release": ("RELEASE", "free"),
    "clean_start": ("CLEAN_START", "cleaning"),
    "clean_done": ("CLEAN_DONE", "free"),
    "oos": ("OOS", "out_of_service"),
    "restore": ("RESTORE", "free"),
}


def outcome_of(action: str) -> dict[str, str]:
    type_, to = _OUTCOMES[action]
    return {"type": type_, "to": to}


# --- capacity -------------------------------------------------------------


def tally_by_kind(beds: list[dict[str, Any]], now: str, order: list[str] | tuple[str, ...]) -> list[dict[str, Any]]:
    tallies: list[dict[str, Any]] = []
    for kind in order:
        of_kind = [bed for bed in beds if bed["kind"] == kind]
        if not of_kind:
            continue
        in_service = [bed for bed in of_kind if bed["state"] != "out_of_service"]
        prices = [bed["nightlyPoisha"] for bed in in_service]
        tallies.append(
            {
                "kind": kind,
                "total": len(in_service),
                "free": sum(1 for bed in in_service if effective_state(bed, now) == "free"),
                "nightlyMinPoisha": min(prices) if prices else None,
                "nightlyMaxPoisha": max(prices) if prices else None,
            }
        )
    return tallies


def next_day(date: str) -> str:
    year, month, day = (int(part) for part in date.split("-"))
    return (datetime(year, month, day, tzinfo=timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")


def forecast_tomorrow(
    beds: list[dict[str, Any]], now: str, today: str, order: list[str] | tuple[str, ...]
) -> list[dict[str, Any]]:
    tomorrow = next_day(today)
    forecasts: list[dict[str, Any]] = []
    for kind in order:
        of_kind = [bed for bed in beds if bed["kind"] == kind]
        if not of_kind:
            continue
        free_now = leaving = cleaning = unforecast = 0
        for bed in of_kind:
            state = effective_state(bed, now)
            if state == "free":
                free_now += 1
            if state == "cleaning":
                cleaning += 1
            if state == "occupied":
                if bed["expectedDischargeDate"] is None:
                    unforecast += 1
                elif bed["expectedDischargeDate"] <= tomorrow:
                    leaving += 1
        forecasts.append(
            {"kind": kind, "freeNow": free_now, "freeTomorrow": free_now + cleaning + leaving, "unforecast": unforecast}
        )
    return forecasts


def mirror_mismatches(board: list[dict[str, Any]], published: dict[str, Any]) -> list[str]:
    published_by_kind = {entry["kind"]: entry for entry in published["byKind"]}
    kinds: list[str] = []
    for kind in [entry["kind"] for entry in board] + list(published_by_kind):
        if kind not in kinds:
            kinds.append(kind)
    mismatched: list[str] = []
    for kind in kinds:
        mine = next((entry for entry in board if entry["kind"] == kind), None)
        theirs = published_by_kind.get(kind)
        mine_free = None if mine is None else mine["free"]
        theirs_free = None if theirs is None else theirs["free"]
        mine_total = None if mine is None else mine["total"]
        theirs_total = None if theirs is None else theirs["total"]
        if mine_free != theirs_free or mine_total != theirs_total:
            mismatched.append(kind)
    return mismatched


def bed_figure(free: int | None, as_of: str | None, now: str, stale_after_minutes: float) -> dict[str, Any]:
    if free is None or as_of is None:
        return {"kind": "unknown"}
    if parse_ms(now) - parse_ms(as_of) < stale_after_minutes * 60_000:
        return {"kind": "count", "free": free}
    return {"kind": "unknown"}
