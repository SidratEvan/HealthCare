"""Counter registration request shapes (port of `schemas/registration.schema.ts`; FR-REC-14, FR-REC-20)."""

from __future__ import annotations

from ...core.schema import z
from ..demo_phones import DEMO_PHONE_NOT_ALLOWED, person_phone_admitted
from ..enums import SEXES

_typed_phone = z.string().trim().min(10).max(20).refine(person_phone_admitted, DEMO_PHONE_NOT_ALLOWED)

registration_lookup_query = z.object({"phone": _typed_phone})

register_patient_body = z.strict_object(
    {
        "phone": _typed_phone,
        "fullName": z.string().trim().min(1).max(120),
        "ageYears": z.number().int().min(0).max(130),
        "sex": z.enum(list(SEXES)),
    }
)
