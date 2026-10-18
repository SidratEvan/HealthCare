"""Public reads: hospitals, doctors, sessions, search (port of `repositories/discovery.repo.ts`)."""

from __future__ import annotations

from typing import Any

from ..core import db


def portal_domains() -> list[dict[str, Any]]:
    """Every live hospital's own portal domain (`FR-BRD-07`)."""
    rows = db.fetch_all(
        """
        SELECT h.portal_domain, h.code, h.id
          FROM hospitals h
         WHERE h.portal_domain IS NOT NULL AND h.code IS NOT NULL
           AND h.deleted_at IS NULL AND h.is_live
        """
    )
    return [{"domain": r["portal_domain"], "code": r["code"], "hospitalId": r["id"]} for r in rows]
