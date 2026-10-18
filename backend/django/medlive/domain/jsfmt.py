"""JavaScript's `String(value)` for the values the domain puts in messages.

Messages a receptionist reads ("Serial 12 is still in the chamber") are built
the same way on both sides, so a number is `12`, not `12.0`, and nothing is
`null`, not `None`.
"""

from __future__ import annotations

import math
import unicodedata
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


def _collation_key(text: str) -> tuple[tuple[str, ...], tuple[str, ...], tuple[int, ...]]:
    # ICU's root collation at its three levels, for the names the API sorts:
    # letters compare without case or accent first, then by accent, then
    # lower case before upper ("apple" < "Apple" < "banana").
    primary: list[str] = []
    secondary: list[str] = []
    tertiary: list[int] = []
    for char in text:
        decomposed = unicodedata.normalize("NFD", char)
        base = "".join(c for c in decomposed if not unicodedata.combining(c)) or char
        primary.append(base.casefold())
        secondary.append("".join(c for c in decomposed if unicodedata.combining(c)))
        tertiary.append(1 if base != base.lower() else 0)
    return tuple(primary), tuple(secondary), tuple(tertiary)


def locale_compare(a: str, b: str) -> int:
    """`a.localeCompare(b)`: negative, zero or positive."""
    left, right = _collation_key(a), _collation_key(b)
    return -1 if left < right else 1 if left > right else 0
