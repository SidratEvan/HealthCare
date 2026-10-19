"""Standby list request shapes (port of `schemas/standby.schema.ts`; FR-QUE-30, FR-PAT-35)."""

from __future__ import annotations

from ...core.schema import z
from .booking import guest_details, payment_method

uuid = z.string().uuid()

standby_prepay_method = z.enum(["bkash", "nagad", "card"])

join_standby_body = z.object(
    {
        "guest": guest_details,
        "prepay": standby_prepay_method.nullable().default(None),
        "clientEventId": uuid.optional(),
    }
)

standby_token_params = z.object(
    {"token": z.string().trim().min(20).max(2000).regex(r"^[A-Za-z0-9_.-]+$", "is not a standby token")}
)

accept_standby_offer_body = z.object({"method": payment_method, "clientEventId": uuid.optional()})

standby_answer_body = z.object({"clientEventId": uuid.optional()})
