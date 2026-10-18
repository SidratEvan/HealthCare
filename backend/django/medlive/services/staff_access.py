"""Whether a staff token is still honoured (port of `services/staffAccess.service.ts`).

A staff token lasts fifteen minutes and is honoured only while the account
and the sign-in behind it still stand (`FR-SEC-06`). An account the database
does not know is not refused here: the token's own claims are what the
guards check.
"""

from __future__ import annotations

from ..repositories import staff_auth as staff_auth_repo


def staff_access_live(staff_id: str, family_id: str | None) -> bool:
    state = staff_auth_repo.access_state(staff_id, family_id)
    if state is None:
        return True
    if not state["accountLive"]:
        return False
    return True if family_id is None else bool(state["familyLive"])
