"""Who a database connection is working for (port of `config/dbScope.ts`).

`FR-SEC-11`, `FR-NET-02`, DATABASE.md §5.2-§5.4, migrations 0043, 0044, 0056.
A request's scope is decided once, from its principal, by the pipeline
middleware, and held for the length of the request in a context variable:
every function that request calls sees it, and no other request's. Each time
SQL runs (`core/db.py`), the scope in force is stated on the connection first,
and the database's row-level policies hold the request to it. No route,
service or repository says anything about scope, and none can forget to.

`system` is the default for code that runs outside a request (the schedule
job, the purge, a management command).
"""

from __future__ import annotations

import contextvars
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator, Union

from .principal import Principal


@dataclass(frozen=True)
class HospitalScope:
    hospital_id: str
    kind: str = "hospital"


@dataclass(frozen=True)
class NationalScope:
    kind: str = "national"


@dataclass(frozen=True)
class PatientScope:
    user_id: str
    kind: str = "patient"


@dataclass(frozen=True)
class GuestScope:
    guest_id: str
    booking_id: str | None
    kind: str = "guest"


@dataclass(frozen=True)
class OpenScope:
    kind: str = "open"


@dataclass(frozen=True)
class SystemScope:
    kind: str = "system"


DbScope = Union[HospitalScope, NationalScope, PatientScope, GuestScope, OpenScope, SystemScope]

SYSTEM = SystemScope()
OPEN = OpenScope()
NATIONAL = NationalScope()

_current: contextvars.ContextVar[DbScope] = contextvars.ContextVar("db_scope", default=SYSTEM)


def current_db_scope() -> DbScope:
    return _current.get()


@contextmanager
def db_scope(scope: DbScope) -> Iterator[None]:
    """Runs the body, and everything it calls, in `scope`."""
    token = _current.set(scope)
    try:
        yield
    finally:
        _current.reset(token)


@contextmanager
def as_queue() -> Iterator[None]:
    """Runs the queue's own work for a person as the server's (migration 0056).

    A patient, a link and nobody reach only their own rows; the queue reduces
    a whole chamber. So the queue acts as the server, only after the
    application has decided the request is theirs to make. Staff and the
    platform stay in their own scope.
    """
    scope = current_db_scope()
    if scope.kind in ("patient", "guest", "open"):
        with db_scope(SYSTEM):
            yield
    else:
        yield


def scope_of_principal(principal: Principal | None) -> DbScope:
    if principal is None:
        return OPEN
    if principal.kind == "staff":
        return HospitalScope(hospital_id=principal.hospital_id or "")
    if principal.kind == "national":
        return NATIONAL
    if principal.kind == "patient":
        return PatientScope(user_id=principal.id)
    return GuestScope(guest_id=principal.id, booking_id=principal.booking_id)


def statement_of(scope: DbScope) -> tuple[str, str, str, str]:
    """`(scope, hospital_id, person_id, booking_id)`, as said to the database."""
    if isinstance(scope, HospitalScope):
        return (scope.kind, scope.hospital_id, "", "")
    if isinstance(scope, PatientScope):
        return (scope.kind, "", scope.user_id, "")
    if isinstance(scope, GuestScope):
        return (scope.kind, "", scope.guest_id, scope.booking_id or "")
    return (scope.kind, "", "", "")
