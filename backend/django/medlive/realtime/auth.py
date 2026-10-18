"""The socket handshake, and closing connections whose access has ended
(port of `realtime/auth.ts`; BACKEND.md §6, FR-SEC-06).

The same `verify_token` and `to_principal` the HTTP pipeline uses: a socket
is not a lesser door than a request. A connection with no valid credential is
refused outright.
"""

from __future__ import annotations

import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from ..core.auth import to_principal
from ..core.jwt import verify_token
from ..core.principal import Principal

_BEARER = re.compile(r"Bearer\s+(.+)", re.IGNORECASE)


@dataclass
class SocketSession:
    sid: str
    principal: Principal
    rooms: set[str] = field(default_factory=set)
    staff_id: str | None = None
    family_id: str | None = None
    expires_at: float | None = None


_lock = threading.Lock()
_sessions: dict[str, SocketSession] = {}

#: Set by the server: closes one connection from this side (thread-safe).
_closer: Callable[[str], None] | None = None


def install_closer(closer: Callable[[str], None]) -> None:
    global _closer
    _closer = closer


def session_of(sid: str) -> SocketSession | None:
    with _lock:
        return _sessions.get(sid)


def forget_socket(sid: str) -> None:
    with _lock:
        _sessions.pop(sid, None)


def remember(session: SocketSession) -> None:
    with _lock:
        _sessions[session.sid] = session


def all_sessions() -> list[SocketSession]:
    with _lock:
        return list(_sessions.values())


def credential_of(auth: Any, environ: dict[str, Any]) -> str | None:
    """`auth.token`, or an `Authorization: Bearer` header."""
    if isinstance(auth, dict):
        token = auth.get("token")
        if isinstance(token, str) and token != "":
            return token
    header = environ.get("HTTP_AUTHORIZATION")
    if isinstance(header, str):
        match = _BEARER.fullmatch(header)
        if match is not None:
            return match.group(1)
    return None


def authenticate(sid: str, auth: Any, environ: dict[str, Any]) -> SocketSession | None:
    """Runs in a worker thread (it reads the database). None means refuse."""
    token = credential_of(auth, environ)
    if token is None:
        return None
    result = verify_token(token, "access")
    if not result.ok:
        return None
    claims = result.claims  # type: ignore[union-attr]
    # Setup tokens have no realtime capability (FR-SEC-06/10).
    if claims.get("mcp") is True or claims.get("tfa") == "setup":
        return None
    principal = to_principal(claims)
    if principal is None:
        return None
    staff_id = claims["sub"] if claims.get("kind") == "staff" else None
    family_id = claims.get("sid") if isinstance(claims.get("sid"), str) else None
    if staff_id is not None:
        from ..services.staff_access import staff_access_live

        if not staff_access_live(staff_id, family_id):
            return None
    exp = claims.get("exp")
    return SocketSession(
        sid=sid,
        principal=principal,
        staff_id=staff_id,
        family_id=family_id,
        expires_at=float(exp) * 1000 if isinstance(exp, (int, float)) else None,
    )


def _drop(match: Callable[[SocketSession], bool]) -> int:
    with _lock:
        chosen = [s for s in _sessions.values() if match(s)]
        for session in chosen:
            _sessions.pop(session.sid, None)
    for session in chosen:
        if _closer is not None:
            _closer(session.sid)
    return len(chosen)


def drop_staff_sockets(staff_id: str) -> int:
    return _drop(lambda s: s.staff_id == staff_id)


def drop_family_sockets(family_id: str) -> int:
    return _drop(lambda s: s.family_id == family_id)


def drop_hospital_sockets(hospital_id: str) -> int:
    return _drop(lambda s: s.principal.kind == "staff" and s.principal.hospital_id == hospital_id)


_STAFF_CHAMBER = re.compile(r"^session:([0-9a-fA-F-]+):staff$")
_SESSION_ROLES = ("receptionist", "doctor", "hospital_admin")


def _rooms_still_allowed(session: SocketSession) -> bool:
    principal = session.principal
    if principal.kind != "staff":
        return True
    from ..core.scope import db_scope, scope_of_principal
    from ..services.desk_access import desk_limit
    from ..services.modules import modules_off
    from ..services.queue import require_session
    from .rooms import ambient_rooms_for

    with db_scope(scope_of_principal(principal)):
        off = modules_off(principal.hospital_id or "")
        ambient = set(ambient_rooms_for(principal, off))
        doctors = desk_limit(principal)
        for room in list(session.rooms):
            chamber = _STAFF_CHAMBER.match(room)
            if chamber is None:
                if room not in ambient:
                    return False
                continue
            if "queue" in off or not any(r in _SESSION_ROLES for r in principal.roles):
                return False
            record = require_session(chamber.group(1))
            if record["hospitalId"] != principal.hospital_id or (
                doctors is not None and record["doctorId"] not in doctors
            ):
                return False
    return True


def sweep_revoked() -> int:
    """Closes connections whose access ended by a road this process did not see."""
    from ..services.staff_access import staff_access_live

    staff = [s for s in all_sessions() if s.staff_id is not None]
    verdicts: dict[str, bool] = {}
    for session in staff:
        key = f"{session.staff_id or ''}|{session.family_id or ''}"
        if key not in verdicts:
            verdicts[key] = staff_access_live(session.staff_id or "", session.family_id)
    forbidden: set[str] = set()
    from ..domain.time import now_ms as _now_ms

    now_ms = _now_ms()
    for session in staff:
        try:
            if (session.expires_at is not None and now_ms >= session.expires_at) or not _rooms_still_allowed(
                session
            ):
                forbidden.add(session.sid)
        except Exception:  # noqa: BLE001 - a lookup failure never renews access
            forbidden.add(session.sid)
    return _drop(
        lambda s: s.staff_id is not None
        and (verdicts.get(f"{s.staff_id}|{s.family_id or ''}") is False or s.sid in forbidden)
    )
