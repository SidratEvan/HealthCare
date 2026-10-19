"""How often the wait quoted at the counter was the wait a patient had
(port of `admin/quotes.ts`; FR-ADM-01, FR-REC-18)."""

from __future__ import annotations

from typing import Any

from ..time import js_round

QUOTE_TOLERANCE_MINUTES = 5


def quote_accuracy(counts: dict[str, Any]) -> dict[str, Any]:
    quoted = counts["quoted"]
    return {
        **counts,
        "keptRate": None if quoted == 0 else counts["kept"] / quoted,
        "avgOverMinutes": None
        if quoted == 0 or counts["avgOverMinutes"] is None
        else js_round(counts["avgOverMinutes"]),
    }
