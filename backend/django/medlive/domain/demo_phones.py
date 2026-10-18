"""The phones a demonstration accepts (`FR-DEM-08`; port of `util/demoPhones.ts`).

Under `DEMO_MODE` the API takes a person's phone only when it is one of the
demonstration's own, listed one by one. No range is trusted.
"""

from __future__ import annotations

from typing import Callable

from .phone import normalise_bd_mobile

DEMO_PHONE_NOT_ALLOWED = "DEMO_PHONE_NOT_ALLOWED"

DEMO_PERSON_PHONES: tuple[str, ...] = (
    "+8801310000001",
    "+8801310000002",
    "+8801310000003",
    "+8801310000004",
    "+8801310000005",
    "+8801380000001",
    "+8801380000002",
    "+8801380000003",
    "+8801380000004",
    "+8801380000005",
    "+8801380000006",
    "+8801380000007",
    "+8801380000008",
    "+8801380000009",
    "+8801380000010",
    "+8801312000106",
    "+8801312000206",
    "+8801512000105",
    "+8801512000205",
    "+8801612000104",
    "+8801612000204",
    "+8801612000304",
    "+8801712000101",
    "+8801712000107",
    "+8801712000201",
    "+8801712000301",
    "+8801812000102",
    "+8801812000108",
    "+8801812000202",
    "+8801812000302",
    "+8801912000103",
    "+8801912000203",
    "+8801912000303",
)

_admission: Callable[[str], bool] | None = None


def set_person_phone_admission(rule: Callable[[str], bool] | None) -> None:
    """Installs (or, with None, removes) the rule a person's phone is held to."""
    global _admission
    _admission = rule


def person_phone_admitted(phone: str) -> bool:
    """Whether a person's phone may be taken. A non-mobile passes: its shape is
    the format check's to refuse."""
    if _admission is None:
        return True
    normalised = normalise_bd_mobile(phone)
    return normalised is None or _admission(normalised)
