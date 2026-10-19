"""Reading a prescription schedule (port of `clinical/prescription.ts`; FR-DOC-04).

A schedule is three doses, morning + midday + night, each a whole number
from 0 to 9 or a half ("½" or "1/2"). Bangla digits are read as Latin ones.
`readMedicineRows` is the console's form helper and is not needed here.
"""

from __future__ import annotations

import re

from ..core.schema import js_trim

MAX_PRESCRIPTION_ROWS = 20
MAX_DURATION_DAYS = 365

_DOSE = re.compile(r"^(?:[0-9]|½|1/2)\Z", re.ASCII)
_BANGLA_DIGIT = re.compile("[০-৯]")

Dose = float | int


def _read_dose(raw: str) -> Dose | None:
    text = js_trim(raw)
    if not _DOSE.match(text):
        return None
    return 0.5 if text in ("½", "1/2") else int(text)


def read_schedule(raw: str) -> dict[str, Dose] | None:
    latin = _BANGLA_DIGIT.sub(lambda m: str(ord(m.group(0)) - 0x09E6), raw)
    parts = latin.split("+")
    if len(parts) != 3:
        return None
    morning, midday, night = (_read_dose(part) for part in parts)
    if morning is None or midday is None or night is None:
        return None
    if morning + midday + night == 0:
        return None
    return {"morning": morning, "midday": midday, "night": night}


def schedule_text(schedule: dict[str, Dose]) -> str:
    def dose(value: Dose) -> str:
        return "½" if value == 0.5 else str(value)

    return f"{dose(schedule['morning'])}+{dose(schedule['midday'])}+{dose(schedule['night'])}"
