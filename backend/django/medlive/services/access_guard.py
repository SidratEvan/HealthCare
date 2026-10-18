"""Ending staff access at once (port of `services/accessGuard.service.ts`; FR-SEC-06).

Revoking a refresh family also drops its open sockets, so a signed-out or
disabled account stops receiving live updates now, not when a token lapses.
"""

from __future__ import annotations

from typing import Any

from ..realtime.auth import drop_family_sockets, drop_staff_sockets
from ..repositories import staff_auth as staff_auth_repo


def revoke_staff_sessions(staff_id: str) -> None:
    staff_auth_repo.revoke_other_sessions(staff_id, None)
    drop_staff_sockets(staff_id)


def end_staff_session(session: dict[str, Any]) -> bool:
    ended = staff_auth_repo.revoke_refresh_session(session["id"])
    if ended:
        drop_family_sockets(session["familyId"])
    return ended
