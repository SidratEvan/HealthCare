"""Queue request shapes (port of `shared/domain/src/schemas/queue.schema.ts`)."""

from __future__ import annotations

from ...core.schema import z
from ..queue.rules import MAX_DELAY_MINUTES, MAX_QUOTED_WAIT_MINUTES

uuid = z.string().uuid()

queue_command_envelope = z.object(
    {
        "clientEventId": uuid.optional(),
        "clientTs": z.string().datetime(offset=True).optional(),
    }
)


def command(shape: dict) -> object:
    return queue_command_envelope.extend(shape)


_reason = z.string().trim().min(1).max(200).nullable().default(None)

doctor_arrived_body = command({})
declare_delay_body = command(
    {
        "minutes": z.number().int().positive().max(MAX_DELAY_MINUTES),
        "reason": _reason,
        "declaredBy": z.enum(["doctor", "reception"]),
    }
)
pause_session_body = command({"reason": _reason})
resume_session_body = command({})
end_session_body = command({"reason": _reason})
call_next_body = command({})

mark_done_body = command({})
mark_late_body = command({"expectedMinutes": z.number().int().positive().max(240)})
mark_no_show_body = command({})
reinstate_body = command({})
check_in_body = command({"quotedWaitMinutes": z.number().int().min(0).max(MAX_QUOTED_WAIT_MINUTES)})
add_walkin_body = command(
    {
        "patientId": uuid,
        "position": z.enum(["end", "index"]).default("end"),
        "index": z.number().int().nonnegative().nullable().default(None),
        "reason": _reason,
    }
).refine(
    lambda value: value["position"] != "index" or (value["index"] is not None and value["reason"] is not None),
    {"message": "Inserting a walk-in at a position needs both an index and a reason (FR-REC-14).", "path": ["reason"]},
)
reorder_body = command(
    {
        "bookingId": uuid,
        "toIndex": z.number().int().nonnegative(),
        "reason": z.string().trim().min(1).max(200),
    }
)
cancel_booking_body = command({"reason": _reason})
undo_body = command({})
offer_slot_body = command({})
accept_offer_body = command({})

session_params = z.object({"id": uuid})
booking_params = z.object({"id": uuid})
event_params = z.object({"id": uuid})
offer_params = z.object({"id": uuid})
queue_query = z.object({"sinceSeq": z.coerce.number().int().nonnegative().optional()})
