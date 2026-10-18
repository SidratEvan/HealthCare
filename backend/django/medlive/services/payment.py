"""Money (port of `services/payment.service.ts`; FR-PAY-*).

The parts the queue needs are here first; the payment routes' service
functions follow with the payments module.
"""

from __future__ import annotations

from typing import Any

from ..core import db
from ..core.logging import logger
from ..repositories import payment as payment_repo


def raise_refunds_for_ended_session(session_id: str) -> dict[str, Any]:
    """`FR-PAY-07`: everybody who paid and was never seen is owed, without asking."""
    with db.transaction():
        standby_owed = payment_repo.mark_refund_owed(
            payment_ids=payment_repo.unseated_standby_for_session(session_id), reason="standby_unseated"
        )
        if standby_owed > 0:
            logger.info({"sessionId": session_id, "standbyOwed": standby_owed}, "standby refunds owed")
        owed = payment_repo.paid_for_session(session_id)
        if not owed:
            return {"eligible": 0, "reason": None}
        reason = "session_ended" if payment_repo.doctor_arrived(session_id) else "doctor_absent"
        eligible = payment_repo.mark_refund_owed(payment_ids=[o["paymentId"] for o in owed], reason=reason)
        logger.info({"sessionId": session_id, "eligible": eligible, "reason": reason}, "refund eligibility raised")
        return {"eligible": eligible, "reason": reason}
