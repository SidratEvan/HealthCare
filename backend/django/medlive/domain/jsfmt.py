"""JavaScript's `String(value)` for the values the domain puts in messages.

Messages a receptionist reads ("Serial 12 is still in the chamber") are built
the same way on both sides, so a number is `12`, not `12.0`, and nothing is
`null`, not `None`.
"""

from __future__ import annotations

import math
from typing import Any


def js_str(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, float):
        if math.isnan(value):
            return "NaN"
        if math.isinf(value):
            return "Infinity" if value > 0 else "-Infinity"
        if value.is_integer() and abs(value) < 1e21:
            return str(int(value))
        return repr(value)
    return str(value)
