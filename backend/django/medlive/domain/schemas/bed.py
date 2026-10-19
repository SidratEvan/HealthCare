"""Ward board request shapes (port of `schemas/bed.schema.ts`; FR-BED-*, S-B-06)."""

from __future__ import annotations

from ...core.schema import z
from ..beds import MAX_HOLD_MINUTES
from ..enums import BED_KINDS
from .booking import guest_details
from .queue import queue_command_envelope

uuid = z.string().uuid()
dhaka_date = z.string().regex(r"^\d{4}-\d{2}-\d{2}$", "must be YYYY-MM-DD")

bed_command_envelope = queue_command_envelope


def _command(shape: dict) -> object:
    return bed_command_envelope.extend(shape)


bed_params = z.object({"id": uuid})
hospital_beds_params = z.object({"id": uuid})
bed_kind = z.enum(list(BED_KINDS))

admit_bed_body = (
    bed_command_envelope.extend(
        {
            "bedRequestId": uuid.nullable().default(None),
            "emergencyCaseId": uuid.nullable().default(None),
            "patient": guest_details.nullable().default(None),
            "expectedDischargeDate": dhaka_date.nullable().default(None),
        }
    )
    .refine(
        lambda body: (body["bedRequestId"] is None) != (body["patient"] is None),
        {
            "message": "Admit either a pending request or a named patient, not both and not neither.",
            "path": ["bedRequestId"],
        },
    )
    .refine(
        lambda body: body["emergencyCaseId"] is None or body["patient"] is not None,
        {"message": "An ER case is admitted with the name the ward takes at the bed.", "path": ["patient"]},
    )
)
discharge_bed_body = _command({})
transfer_bed_body = _command({"toBedId": uuid})
reserve_bed_body = _command({"minutes": z.number().int().positive().max(MAX_HOLD_MINUTES)})
release_bed_body = _command({})
clean_start_body = _command({})
clean_done_body = _command({})
out_of_service_body = _command({"reason": z.string().trim().min(1).max(200)})
restore_bed_body = _command({})
expected_discharge_body = _command({"date": dhaka_date.nullable()})

create_bed_request_body = z.object(
    {
        "hospitalId": uuid,
        "bedKind": bed_kind,
        "patient": guest_details,
        "expectedArrivalAt": z.string().datetime(offset=True).nullable().default(None),
        "note": z.string().trim().max(500).nullable().default(None),
    }
)

respond_bed_request_body = z.discriminated_union(
    "action",
    [
        bed_command_envelope.extend(
            {
                "action": z.literal("hold"),
                "bedId": uuid,
                "minutes": z.number().int().positive().max(MAX_HOLD_MINUTES),
            }
        ),
        bed_command_envelope.extend({"action": z.literal("confirm"), "bedId": uuid.nullable().default(None)}),
        bed_command_envelope.extend({"action": z.literal("decline")}),
    ],
)

bed_request_token_params = z.object(
    {"token": z.string().trim().min(20).max(2000).regex(r"^[A-Za-z0-9_.-]+$", "is not a request token")}
)
