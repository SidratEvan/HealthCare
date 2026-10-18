"""Staff accounts and sign-in sessions (port of `repositories/staffAuth.repo.ts`)."""

from __future__ import annotations

from typing import Any

from ..core import db


def access_state(staff_id: str, family_id: str | None) -> dict[str, Any] | None:
    """Whether the account, and the sign-in a token names, still stand (`FR-SEC-06`)."""
    row = db.fetch_one(
        """
        SELECT (su.is_active AND su.deleted_at IS NULL) AS account_live,
               EXISTS (
                 SELECT 1 FROM sessions_auth sa
                  WHERE sa.family_id = %s::uuid
                    AND sa.subject_kind = 'staff'
                    AND sa.subject_id = su.id
                    AND sa.revoked_at IS NULL
                    AND sa.expires_at > now()
               ) AS family_live
          FROM staff_users su
         WHERE su.id = %s::uuid
        """,
        [family_id, staff_id],
    )
    if row is None:
        return None
    return {"accountLive": bool(row["account_live"]), "familyLive": bool(row["family_live"])}
