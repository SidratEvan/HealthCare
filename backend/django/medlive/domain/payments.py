"""Who pays first, what a refund returns, and a settlement's totals (port of
`payments/prepay.ts`, `payments/refund.ts` and `payments/settlement.ts`;
FR-PAY-*, FR-SUP-04)."""

from __future__ import annotations

import math
from typing import Any

from .time import js_round, to_epoch_ms

NOSHOW_PREPAY_THRESHOLD = 3


def prepayment_reason(
    *, online_payment_taken: bool, hospital_pays_first: bool, guest: bool, no_show_rule_on: bool, no_shows: int
) -> str | None:
    if not online_payment_taken:
        return None
    if hospital_pays_first:
        return "hospital"
    if guest and no_show_rule_on and no_shows >= NOSHOW_PREPAY_THRESHOLD:
        return "no_shows"
    return None


REFUND_REASONS = (
    "patient_cancelled",
    "doctor_absent",
    "session_ended",
    "standby_unseated",
    "duplicate_payment",
    "paid_after_release",
)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_percent(value: Any) -> bool:
    return _is_number(value) and math.isfinite(value) and 0 <= value <= 100


def read_refund_policy(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    cutoff_hours = value.get("cutoffHours")
    before = value.get("beforeCutoffPercent")
    after = value.get("afterCutoffPercent")
    fee_refundable = value.get("platformFeeRefundable", _ABSENT)
    if not _is_percent(before) or not _is_percent(after):
        return None
    if not _is_number(cutoff_hours) or not math.isfinite(cutoff_hours) or cutoff_hours < 0:
        return None
    if fee_refundable is not _ABSENT and not isinstance(fee_refundable, bool):
        return None
    return {
        "cutoffHours": cutoff_hours,
        "beforeCutoffPercent": before,
        "afterCutoffPercent": after,
        "platformFeeRefundable": fee_refundable is True,
    }


_ABSENT: Any = object()


def _nothing_to_refund(reason: str, guaranteed: bool) -> dict[str, Any]:
    return {"refundPoisha": 0, "reason": reason, "guaranteed": guaranteed, "stated": True}


def refund_for(
    payment: dict[str, Any], *, reason: str, now: str, session_start: str, policy: dict[str, Any] | None
) -> dict[str, Any]:
    remaining = payment["amountPoisha"] - payment["refundedPoisha"]
    if payment["paidAt"] is None or remaining <= 0:
        return _nothing_to_refund(reason, reason != "patient_cancelled")
    if reason in ("doctor_absent", "session_ended", "standby_unseated", "duplicate_payment", "paid_after_release"):
        return {"refundPoisha": remaining, "reason": reason, "guaranteed": True, "stated": True}
    if policy is None:
        return {"refundPoisha": 0, "reason": reason, "guaranteed": False, "stated": False}
    hours_of_notice = (to_epoch_ms(session_start) - to_epoch_ms(now)) / (60 * 60 * 1000)
    percent = policy["beforeCutoffPercent"] if hours_of_notice >= policy["cutoffHours"] else policy["afterCutoffPercent"]
    consultation_poisha = payment["amountPoisha"] - payment["platformFeePoisha"]
    consultation_back = js_round((consultation_poisha * percent) / 100)
    fee_back = js_round((payment["platformFeePoisha"] * percent) / 100) if policy["platformFeeRefundable"] else 0
    return {
        "refundPoisha": min(consultation_back + fee_back, remaining),
        "reason": reason,
        "guaranteed": False,
        "stated": True,
    }


def refund_if_cancelled_now(
    payment: dict[str, Any], *, now: str, session_start: str, policy: dict[str, Any] | None
) -> dict[str, Any]:
    return refund_for(payment, reason="patient_cancelled", now=now, session_start=session_start, policy=policy)


_COLLECTED_STATES = ("paid", "refunded", "partially_refunded")
_AT_HOSPITAL_METHODS = ("cash", "at_hospital")


def settle(rows: list[dict[str, Any]]) -> dict[str, Any]:
    collected = 0
    collections = 0
    refunds = 0
    platform_fee = 0
    at_hospital = 0
    fee_owed_on_cash = 0
    online_collections = 0
    online_refunds = 0
    by_method: dict[str, dict[str, int]] = {}
    for row in rows:
        if row["state"] not in _COLLECTED_STATES:
            continue
        collected += 1
        collections += row["amountPoisha"]
        refunds += row["refundedPoisha"]
        retained_fee = max(0, min(row["platformFeePoisha"], row["amountPoisha"] - row["refundedPoisha"]))
        if row["method"] in _AT_HOSPITAL_METHODS:
            at_hospital += row["amountPoisha"]
            fee_owed_on_cash += retained_fee
        else:
            platform_fee += retained_fee
            online_collections += row["amountPoisha"]
            online_refunds += row["refundedPoisha"]
        bucket = by_method.get(row["method"], {"count": 0, "collectionsPoisha": 0, "refundsPoisha": 0})
        by_method[row["method"]] = {
            "count": bucket["count"] + 1,
            "collectionsPoisha": bucket["collectionsPoisha"] + row["amountPoisha"],
            "refundsPoisha": bucket["refundsPoisha"] + row["refundedPoisha"],
        }
    return {
        "payments": len(rows),
        "collected": collected,
        "collectionsPoisha": collections,
        "refundsPoisha": refunds,
        "netCollectionsPoisha": collections - refunds,
        "platformFeePoisha": platform_fee,
        "payoutPoisha": max(0, online_collections - online_refunds - platform_fee),
        "atHospitalPoisha": at_hospital,
        "feeOwedOnCashPoisha": fee_owed_on_cash,
        "disputes": 0,
        # A stable sort, as Array.prototype.sort is.
        "byMethod": sorted(
            ({"method": method, **totals} for method, totals in by_method.items()),
            key=lambda entry: -entry["collectionsPoisha"],
        ),
    }
