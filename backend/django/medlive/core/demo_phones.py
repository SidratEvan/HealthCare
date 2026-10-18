"""The demonstration's phone rule (port of `config/demoPhones.ts`; FR-DEM-08).

Installed into the shared schemas once, as the route table is built: under
`DEMO_MODE` a person's phone is taken only from the demonstration's own list,
during validation, so before anything is written.
"""

from __future__ import annotations

from ..domain.demo_phones import DEMO_PERSON_PHONES, set_person_phone_admission
from .env import env


def demo_phone_admitted(phone: str) -> bool:
    e = env()
    if not e.DEMO_MODE:
        return True
    allowed = e.DEMO_PHONES if e.DEMO_PHONES is not None else DEMO_PERSON_PHONES
    return allowed == "any" or phone in allowed


def install_demo_phone_rule() -> None:
    set_person_phone_admission(demo_phone_admitted)
