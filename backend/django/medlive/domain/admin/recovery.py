"""No-show loss and its recovery (port of `admin/recovery.ts`; FR-ADM-03)."""

from __future__ import annotations

from typing import Any


def loss_and_recovery(no_shows: dict[str, int], recovery: dict[str, int]) -> dict[str, Any]:
    uncollected = max(0, no_shows["forgonePoisha"] - no_shows["prepaidPoisha"])
    return {
        "noShowCount": no_shows["count"],
        "forgonePoisha": no_shows["forgonePoisha"],
        "prepaidPoisha": no_shows["prepaidPoisha"],
        "uncollectedPoisha": uncollected,
        "offered": recovery["offered"],
        "accepted": recovery["accepted"],
        "recoveredPoisha": recovery["recoveredPoisha"],
        "recoveryRate": None if uncollected == 0 else recovery["recoveredPoisha"] / uncollected,
        "acceptanceRate": None if recovery["offered"] == 0 else recovery["accepted"] / recovery["offered"],
        "netLossPoisha": uncollected - recovery["recoveredPoisha"],
    }


def recovered_value_for(replacement_fee_poisha: int) -> int:
    """What a filled chair recovered: the fee the replacement booking carries."""
    if isinstance(replacement_fee_poisha, bool) or not isinstance(replacement_fee_poisha, int) or replacement_fee_poisha < 0:
        raise ValueError("A recovered value is a non-negative whole number of poisha.")
    return replacement_fee_poisha
