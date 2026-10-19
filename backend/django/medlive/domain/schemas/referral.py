"""Referral request shapes (port of `schemas/referral.schema.ts`; FR-EMG-07..09)."""

from __future__ import annotations

from ...core.schema import z
from ..emergency.referrals import REFERRAL_NOTE_MAX
from ..enums import BED_KINDS, CAPABILITY_KINDS
from .emergency import emergency_command_envelope

uuid = z.string().uuid()

referral_send_body = emergency_command_envelope.extend(
    {
        "emergencyCaseId": uuid,
        "toHospitalId": uuid,
        "requiredCapability": z.enum(list(CAPABILITY_KINDS)).nullable().default(None),
        "requiredBedKind": z.enum(list(BED_KINDS)).nullable().default(None),
        "note": z.string()
        .trim()
        .max(REFERRAL_NOTE_MAX)
        .nullable()
        .default(None)
        .transform(lambda value: None if value is None or value == "" else value),
    }
).refine(
    lambda body: body["requiredCapability"] is not None or body["requiredBedKind"] is not None,
    {
        "message": "Say what the referral asks for: a capability, a kind of bed, or both.",
        "path": ["requiredCapability"],
    },
)

referral_params = z.object({"id": uuid})
referral_action_body = emergency_command_envelope
referral_decline_body = emergency_command_envelope.extend({"reason": z.string().trim().min(1).max(300)})
