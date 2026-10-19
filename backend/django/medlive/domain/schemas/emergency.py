"""Emergency request shapes (port of `schemas/emergency.schema.ts`; FR-ER-*, S-B-07)."""

from __future__ import annotations

from ...core.schema import z
from ..enums import BED_KINDS, CAPABILITY_KINDS, EMERGENCY_PROBLEMS, SEXES, TRIAGE_COLORS
from .booking import bd_phone
from .queue import queue_command_envelope

uuid = z.string().uuid()

emergency_problem = z.enum(list(EMERGENCY_PROBLEMS))
triage_color = z.enum(list(TRIAGE_COLORS))
capability_kind = z.enum(list(CAPABILITY_KINDS))

latitude = z.coerce.number().min(20).max(27)
longitude = z.coerce.number().min(88).max(93)

emergency_search_query = (
    z.object(
        {
            "lat": latitude.optional(),
            "lng": longitude.optional(),
            "problem": emergency_problem.optional(),
            "from": uuid.optional(),
            "capability": capability_kind.optional(),
            "bedKind": z.enum(list(BED_KINDS)).optional(),
        }
    )
    .refine(
        lambda query: (query.get("lat") is None) == (query.get("lng") is None),
        {"message": "Give both lat and lng, or neither.", "path": ["lat"]},
    )
    .refine(
        lambda query: query.get("from") is None or query.get("lat") is None,
        {"message": "Search from a hospital or from a position, not both.", "path": ["from"]},
    )
    .refine(
        lambda query: query.get("from") is not None
        or (query.get("capability") is None and query.get("bedKind") is None),
        {
            "message": "capability and bedKind belong to the refer-out search, which needs from.",
            "path": ["capability"],
        },
    )
)

inbound_body = z.object(
    {
        "hospitalId": uuid,
        "problem": emergency_problem,
        "lat": latitude.nullable().default(None),
        "lng": longitude.nullable().default(None),
        "phone": bd_phone.nullable().default(None),
        "ageYears": z.number().int().min(0).max(130).nullable().default(None),
        "sex": z.enum(list(SEXES)).nullable().default(None),
    }
)

emergency_command_envelope = queue_command_envelope

walk_in_body = emergency_command_envelope.extend(
    {
        "problem": emergency_problem,
        "triage": triage_color.nullable().default(None),
        "phone": bd_phone.nullable().default(None),
        "ageYears": z.number().int().min(0).max(130).nullable().default(None),
        "sex": z.enum(list(SEXES)).nullable().default(None),
    }
)

emergency_case_params = z.object({"id": uuid})
acknowledge_body = emergency_command_envelope

case_command_body = z.discriminated_union(
    "action",
    [
        emergency_command_envelope.extend({"action": z.literal("accept")}),
        emergency_command_envelope.extend(
            {"action": z.literal("decline"), "reason": z.string().trim().min(1).max(300)}
        ),
        emergency_command_envelope.extend({"action": z.literal("triage"), "triage": triage_color}),
        emergency_command_envelope.extend({"action": z.literal("handoff"), "bedKind": z.enum(list(BED_KINDS))}),
        emergency_command_envelope.extend({"action": z.literal("discharge")}),
    ],
)

capabilities_body = emergency_command_envelope.extend(
    {
        "capabilities": z.array(z.object({"kind": capability_kind, "available": z.boolean()}))
        .min(1)
        .max(len(CAPABILITY_KINDS))
        .refine(
            lambda entries: len({entry["kind"] for entry in entries}) == len(entries),
            "Each capability may appear once.",
        )
    }
)

hospital_emergency_params = z.object({"id": uuid})

emergency_token_params = z.object(
    {"token": z.string().trim().min(20).max(2000).regex(r"^[A-Za-z0-9_.-]+$", "is not a case token")}
)
