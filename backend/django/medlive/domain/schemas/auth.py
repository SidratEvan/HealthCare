"""Sign-in request shapes, staff and patient (port of `schemas/auth.schema.ts`; FR-SEC-05, FR-SEC-06)."""

from __future__ import annotations

from ...core.schema import z
from ..demo_phones import DEMO_PHONE_NOT_ALLOWED, person_phone_admitted

_email = z.string().trim().min(3).max(254).includes("@")
_password = z.string().min(1).max(200)

hospital_code = z.string().trim().regex(r"^[A-Za-z0-9][A-Za-z0-9-]{1,15}$").transform(lambda value: value.upper())

staff_login_body = z.strict_object({"email": _email, "password": _password, "hospitalCode": hospital_code.optional()})

staff_refresh_body = z.strict_object({"refresh": z.string().min(20).max(200)})

staff_password_body = z.strict_object({"current": _password, "next": _password})

totp_code = z.string().trim().regex(r"^[0-9]{6}$")

staff_two_factor_body = z.strict_object(
    {"challenge": z.string().min(20).max(2_000), "code": z.string().trim().min(6).max(24)}
)

staff_two_factor_enable_body = z.strict_object({"code": totp_code})

_typed_phone = z.string().trim().min(10).max(20).refine(person_phone_admitted, DEMO_PHONE_NOT_ALLOWED)

otp_request_body = z.strict_object({"phone": _typed_phone})

otp_verify_body = z.strict_object({"phone": _typed_phone, "code": z.string().regex(r"^[0-9]{6}$")})

patient_refresh_body = z.strict_object({"refresh": z.string().min(20).max(200)})

claim_body = z.strict_object({"confirm": z.boolean().default(False)})

guest_start_body = z.strict_object(
    {
        "phone": _typed_phone,
        "name": z.string().trim().min(1).max(120),
        "deviceProof": z.string().min(20).max(2000).optional(),
    }
)

guest_verify_body = z.strict_object(
    {"phone": _typed_phone, "name": z.string().trim().min(1).max(120), "code": z.string().regex(r"^[0-9]{6}$")}
)
