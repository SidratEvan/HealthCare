"""Which patient-app address a request came from (port of `config/requestOrigin.ts`).

Held for the length of the request so a link issued while answering it opens
where the patient is (`FR-BRD-04`, `FR-BRD-07`).
"""

from __future__ import annotations

import contextvars
from contextlib import contextmanager
from typing import Iterator

_origin: contextvars.ContextVar[str | None] = contextvars.ContextVar("patient_origin", default=None)


@contextmanager
def with_patient_origin(origin: str | None) -> Iterator[None]:
    token = _origin.set(origin)
    try:
        yield
    finally:
        _origin.reset(token)


def current_patient_origin() -> str | None:
    return _origin.get()
