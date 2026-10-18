"""Test orders, medicine stock and turnaround (port of `lab/orders.ts`, `lab/stock.ts` and
`lab/turnaround.ts`; FR-LAB-01..08, FR-PHA-*)."""

from __future__ import annotations

import functools
import math
from typing import Any

from .emergency.freshness import freshness_of
from .jsfmt import locale_compare
from .time import js_round, parse_ms, to_epoch_ms

OPEN_TEST_STATES = ("ordered", "sample_collected", "processing")
REPORTED_TEST_STATES = ("report_ready", "delivered")
LAB_ACTIONS = ("collect", "process", "ready", "cancel")

LAB_ACTION_RESULT = {
    "collect": "sample_collected",
    "process": "processing",
    "ready": "report_ready",
    "cancel": "cancelled",
}

_PROGRESS = {
    "ordered": 0,
    "sample_collected": 1,
    "processing": 2,
    "report_ready": 3,
    "delivered": 4,
    "cancelled": -1,
}

_ALLOWED: dict[str, Any] = {"ok": True}


def _deny(code: str, detail: str) -> dict[str, Any]:
    return {"ok": False, "code": code, "detail": detail}


def is_open_test_order(state: str) -> bool:
    return state in OPEN_TEST_STATES


def has_report(state: str) -> bool:
    return state in REPORTED_TEST_STATES


def can_act_on_test_order(current: dict[str, Any], action: str) -> dict[str, Any]:
    state = current["state"]
    if action == "cancel":
        if has_report(state):
            return _deny("REPORT_EXISTS", "A test with a report cannot be cancelled; the result is the patient’s.")
        return _ALLOWED if is_open_test_order(state) else _deny("WRONG_STATE", f"A {state} test order cannot be cancelled.")
    target = LAB_ACTION_RESULT[action]
    frm = _PROGRESS[state]
    to = _PROGRESS[target]
    if frm < 0:
        return _deny("WRONG_STATE", "A cancelled test order cannot be worked on.")
    if to <= frm:
        return _deny("WRONG_STATE", f"A {state} test order cannot go back to {target}; cancel and re-order instead.")
    if to > frm + 1:
        return _deny("WRONG_STATE", f"A {state} test order has to be {_previous_of(target)} first.")
    return _ALLOWED


def _previous_of(state: str) -> str:
    order = ["ordered", "sample_collected", "processing", "report_ready", "delivered"]
    index = order.index(state) if state in order else -1
    return order[index - 1] if index > 0 else "ordered"


def can_upload_report(current: dict[str, Any]) -> dict[str, Any]:
    state = current["state"]
    if state in ("processing", "report_ready"):
        return _ALLOWED
    if state == "delivered":
        return _deny("WRONG_STATE", "This report has already reached the patient.")
    if state in ("ordered", "sample_collected"):
        return _deny("WRONG_STATE", "Take the sample and start processing before uploading a report.")
    return _deny("WRONG_STATE", "A cancelled test order cannot take a report.")


def can_deliver_report(current: dict[str, Any]) -> dict[str, Any]:
    if current["report"] is None:
        return _deny("NO_REPORT", "There is no report to deliver.")
    if current["state"] == "report_ready":
        return _ALLOWED
    return _deny("WRONG_STATE", f"A {current['state']} test order is not ready to deliver.")


def lab_order_already_applied(current: dict[str, Any], action: str) -> bool:
    if action == "cancel":
        return current["state"] == "cancelled"
    frm = _PROGRESS[current["state"]]
    if frm < 0:
        return False
    return frm >= _PROGRESS[LAB_ACTION_RESULT[action]]


def sort_lab_queue(orders: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def compare(a: dict[str, Any], b: dict[str, Any]) -> float:
        a_open = is_open_test_order(a["state"])
        b_open = is_open_test_order(b["state"])
        if a_open != b_open:
            return -1 if a_open else 1
        a_time = parse_ms(a["orderedAt"])
        b_time = parse_ms(b["orderedAt"])
        return a_time - b_time if a_open else b_time - a_time

    return sorted(orders, key=functools.cmp_to_key(compare))


STOCK_STALE_THRESHOLD_MINUTES = 12 * 60
STOCK_ANSWERS = ("in_stock", "out_of_stock", "unknown")


def stock_answer_for(
    flag: dict[str, Any] | None, now: str, threshold_minutes: float = STOCK_STALE_THRESHOLD_MINUTES
) -> dict[str, Any]:
    if flag is None:
        return {"answer": "unknown", "freshness": freshness_of([None], now, threshold_minutes)}
    freshness = freshness_of([flag["updatedAt"]], now, threshold_minutes)
    if not flag["inStock"]:
        return {"answer": "out_of_stock", "freshness": freshness}
    return {"answer": "unknown" if freshness["stale"] else "in_stock", "freshness": freshness}


_STOCK_RANK = {"in_stock": 0, "unknown": 1, "out_of_stock": 2}


def rank_stock_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def compare(a: dict[str, Any], b: dict[str, Any]) -> float:
        if _STOCK_RANK[a["answer"]] != _STOCK_RANK[b["answer"]]:
            return _STOCK_RANK[a["answer"]] - _STOCK_RANK[b["answer"]]
        a_km, b_km = a["distanceKm"], b["distanceKm"]
        if a_km is not None and b_km is not None and a_km != b_km:
            return a_km - b_km
        if a_km is not None and b_km is None:
            return -1
        if a_km is None and b_km is not None:
            return 1
        a_age = a["freshness"]["ageMinutes"]
        b_age = b["freshness"]["ageMinutes"]
        if a_age is None and b_age is None:
            return locale_compare(a["hospitalNameEn"], b["hospitalNameEn"])
        if a_age is None:
            return 1
        if b_age is None:
            return -1
        return a_age - b_age

    return sorted(results, key=functools.cmp_to_key(compare))


def summarise_stock_search(results: list[dict[str, Any]]) -> dict[str, int]:
    in_stock = sum(1 for r in results if r["answer"] == "in_stock")
    out_of_stock = sum(1 for r in results if r["answer"] == "out_of_stock")
    return {"inStock": in_stock, "outOfStock": out_of_stock, "unknown": len(results) - in_stock - out_of_stock}


def turnaround_seconds(order: dict[str, Any]) -> int | None:
    if order["readyAt"] is None or order["state"] == "cancelled":
        return None
    elapsed = to_epoch_ms(order["readyAt"]) - to_epoch_ms(order["orderedAt"])
    return js_round(elapsed / 1000) if elapsed >= 0 else None


def open_for_seconds(order: dict[str, Any], now: str | float) -> int | None:
    if not is_open_test_order(order["state"]):
        return None
    now_epoch = now if isinstance(now, (int, float)) else to_epoch_ms(now)
    elapsed = now_epoch - to_epoch_ms(order["orderedAt"])
    return js_round(elapsed / 1000) if elapsed >= 0 else 0


def _median(values: list[int]) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = math.floor(len(ordered) / 2)
    if len(ordered) % 2 == 1:
        return ordered[middle]
    return js_round((ordered[middle - 1] + ordered[middle]) / 2)


def summarise_turnaround(orders: list[dict[str, Any]], now: str | float) -> list[dict[str, Any]]:
    by_code: dict[str, list[dict[str, Any]]] = {}
    for order in orders:
        by_code.setdefault(order["testCode"], []).append(order)
    summaries: list[dict[str, Any]] = []
    for test_code, bucket in by_code.items():
        measured: list[int] = []
        open_count = 0
        oldest_open: int | None = None
        for order in bucket:
            seconds = turnaround_seconds(order)
            if seconds is not None:
                measured.append(seconds)
                continue
            waiting = open_for_seconds(order, now)
            if waiting is not None:
                open_count += 1
                oldest_open = waiting if oldest_open is None else max(oldest_open, waiting)
        summaries.append(
            {
                "testCode": test_code,
                "testName": bucket[0]["testName"] if bucket else test_code,
                "completed": len(measured),
                "open": open_count,
                "medianSeconds": _median(measured),
                "slowestSeconds": max(measured) if measured else None,
                "oldestOpenSeconds": oldest_open,
            }
        )

    def compare(a: dict[str, Any], b: dict[str, Any]) -> float:
        if a["medianSeconds"] is None or b["medianSeconds"] is None:
            if a["medianSeconds"] == b["medianSeconds"]:
                return locale_compare(a["testName"], b["testName"])
            return 1 if a["medianSeconds"] is None else -1
        return b["medianSeconds"] - a["medianSeconds"]

    return sorted(summaries, key=functools.cmp_to_key(compare))
