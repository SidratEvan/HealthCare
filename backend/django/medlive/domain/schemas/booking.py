"""Booking, discovery and tracking-link request shapes (port of `schemas/booking.schema.ts`)."""

from __future__ import annotations

from ...core.schema import z
from ..demo_phones import DEMO_PHONE_NOT_ALLOWED, person_phone_admitted
from ..enums import BED_KINDS

uuid = z.string().uuid()

bd_phone = (
    z.string()
    .trim()
    .regex(r"^\+8801[3-9]\d{8}$", "must be a Bangladeshi mobile number, e.g. +8801712345678")
    .refine(person_phone_admitted, DEMO_PHONE_NOT_ALLOWED)
)

scope_code = z.string().trim().regex(r"^[A-Za-z0-9][A-Za-z0-9-]{1,15}$").transform(lambda value: value.upper())

config_query = z.object(
    {
        "scope": scope_code.optional(),
        "host": z.string().trim().min(1).max(260).optional(),
    }
)

hospital_query = z.object(
    {
        "scope": scope_code.optional(),
        "specialty": z.string().trim().min(1).max(20).optional(),
        "district": z.string().trim().min(1).max(60).optional(),
        "q": z.string().trim().min(1).max(80).optional(),
        "lat": z.coerce.number().min(20).max(27).optional(),
        "lng": z.coerce.number().min(87.5).max(93).optional(),
        "bedKind": z.enum(BED_KINDS).optional(),
        "limit": z.coerce.number().int().positive().max(100).default(50),
    }
)

doctor_query = z.object(
    {
        "scope": scope_code.optional(),
        "specialty": z.string().trim().min(1).max(20).optional(),
        "hospitalId": uuid.optional(),
        "q": z.string().trim().min(1).max(80).optional(),
        "limit": z.coerce.number().int().positive().max(100).default(50),
    }
)

search_query = z.object(
    {
        "scope": scope_code.optional(),
        "q": z.string().trim().min(1).max(80).optional(),
        "need": z.string().trim().regex(r"^(specialty|bed|capability):[A-Za-z_]{2,20}$").optional(),
        "lat": z.coerce.number().min(20).max(27).optional(),
        "lng": z.coerce.number().min(87.5).max(93).optional(),
        "limit": z.coerce.number().int().positive().max(50).default(30),
    }
)

session_query = z.object({"doctorId": uuid.optional(), "hospitalId": uuid.optional()})

id_params = z.object({"id": uuid})

payment_method = z.enum(["bkash", "nagad", "card", "at_hospital"])

guest_details = z.object(
    {
        "name": z.string().trim().min(2).max(80),
        "phone": bd_phone,
        "ageYears": z.number().int().min(0).max(130),
        "sex": z.enum(["male", "female", "other"]),
    }
)

create_booking_body = z.object(
    {
        "sessionId": uuid,
        "method": payment_method,
        "patientId": uuid.optional(),
        "guest": guest_details.optional(),
        "reason": z.string().trim().max(500).optional(),
        "intake": z.record(z.string(), z.unknown()).optional(),
        "arrivalWindowStart": z.string().datetime(offset=True).optional(),
    }
)

tracking_link_params = z.object(
    {"token": z.string().trim().min(20).max(200).regex(r"^[A-Za-z0-9_-]+$", "is not a tracking token")}
)

tracking_report_params = tracking_link_params.extend({"reportId": z.string().uuid()})

demo_token_body = z.union(
    [
        z.object(
            {
                "hospitalId": uuid,
                "role": z.enum(["receptionist", "doctor", "ward", "emergency", "lab", "pharmacy", "hospital_admin"]),
            }
        ),
        z.strict_object({"role": z.enum(["gov_viewer", "platform_admin"])}),
    ]
)
