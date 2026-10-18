"""Bangladeshi mobile numbers (`DB-P6`; port of `shared/domain/src/util/phone.ts`).

Normalised, never corrected: a number with a digit missing is refused, not
padded, because an SMS to somebody else's phone is worse than no SMS.
"""

from __future__ import annotations

import re

#: The stored shape: `+880`, then an operator digit 3-9, then eight digits.
BD_MOBILE = re.compile(r"^\+8801[3-9][0-9]{8}$")
# `[0-9]`, not `\d`: in Python `\d` also matches Bengali digits (১২৩), which
# JavaScript's does not. Every pattern ported from the TypeScript keeps ASCII.

_SEPARATORS = re.compile(r"[\s\-().]")


def normalise_bd_mobile(value: str) -> str | None:
    """`+8801XXXXXXXXX`, or None when the input cannot be a Bangladeshi mobile."""
    digits = _SEPARATORS.sub("", value)
    if digits.startswith("+"):
        candidate = digits
    elif digits.startswith("880"):
        candidate = f"+{digits}"
    elif digits.startswith("01"):
        candidate = f"+88{digits}"
    else:
        candidate = digits
    # `$` in Python also matches before a trailing newline; fullmatch does not.
    return candidate if BD_MOBILE.fullmatch(candidate) else None
