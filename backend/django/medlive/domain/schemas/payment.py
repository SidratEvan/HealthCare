"""Payment request shapes (port of `schemas/payment.schema.ts`; FR-PAY-*)."""

from __future__ import annotations

from ...core.schema import UNDEFINED, z
from ..enums import PAYMENT_METHODS
from ..payments import REFUND_REASONS

uuid = z.string().uuid()


def _pays_for_one_thing(body: dict) -> bool:
    keys = ("bookingId", "bedRequestId", "testOrderId", "ambulanceRequestId")
    return len([k for k in keys if body.get(k, UNDEFINED) is not UNDEFINED]) == 1


payment_intent_body = z.object(
    {
        "bookingId": uuid.optional(),
        "bedRequestId": uuid.optional(),
        "testOrderId": uuid.optional(),
        "ambulanceRequestId": uuid.optional(),
        "method": z.enum(list(PAYMENT_METHODS)),
        "idempotencyKey": uuid,
    }
).refine(_pays_for_one_thing, {"message": "A payment pays for exactly one thing.", "path": ["bookingId"]})

payment_params = z.object({"id": uuid})
payment_confirm_params = z.object({"id": uuid, "paymentId": uuid})
payment_confirm_body = z.object({"hint": z.enum(["success", "failure", "cancel"]).nullable().optional()})

refund_body = z.object(
    {
        "reason": z.enum(list(REFUND_REASONS)),
        "note": z.string().trim().max(300).nullable().default(None),
        "idempotencyKey": uuid,
    }
)

_DATE = r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
settlement_query = z.object(
    {
        "from": z.string().regex(_DATE, "must be a date as YYYY-MM-DD"),
        "to": z.string().regex(_DATE, "must be a date as YYYY-MM-DD"),
    }
)
