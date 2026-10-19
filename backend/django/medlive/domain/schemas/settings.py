"""Request shapes for a facility's own setup (port of `schemas/settings.schema.ts`;
S-B-11, FR-SUP-01, FR-ADM-11, BACKEND.md §7.7 `/hospital/*`).

Strict objects: a stray field is a 400. Money is integer poisha (DB-P5).
Times are Asia/Dhaka wall clock `HH:MM`, because a schedule is what the
chamber door says, not an instant.
"""

from __future__ import annotations

from ...core.schema import z
from ..enums import AGREEMENT_STATES, BED_KINDS, CAPABILITY_KINDS, FACILITY_KINDS

uuid = z.string().uuid()
name = z.string().trim().min(1).max(120)


def _optional_text(maximum: int):  # type: ignore[no-untyped-def]
    return z.string().trim().min(1).max(maximum).nullable().optional()


#: `hospitals.phone` accepts a landline as well as a mobile (0004).
facility_phone = z.string().trim().regex(r"^\+880[0-9]{8,11}$", "must start +880, e.g. +8802912345678")

#: Integer poisha, up to ten lakh taka: a sanity bound, not a price.
poisha = z.number().int().min(0).max(100_000_000)

wall_clock = z.string().regex(r"^([01]\d|2[0-3]):[0-5]\d$", "must be HH:MM")

#: What a hospital administrator may give; platform and national roles belong to no facility.
FACILITY_ROLES = ("receptionist", "doctor", "ward", "emergency", "lab", "pharmacy", "hospital_admin")

roles = (
    z.array(z.enum(list(FACILITY_ROLES)))
    .min(1)
    .max(len(FACILITY_ROLES))
    .refine(lambda values: len(set(values)) == len(values), "each role once")
)

settings_id_params = z.object({"id": uuid})


def _changes_something(body: dict) -> bool:
    return len(body) > 0


# --- profile and queue rules ---------------------------------------------

profile_body = z.strict_object(
    {
        "nameBn": name.optional(),
        "nameEn": name.optional(),
        "division": z.string().trim().min(2).max(40).optional(),
        "district": z.string().trim().min(2).max(60).optional(),
        "registrationNo": _optional_text(60),
        "thana": _optional_text(80),
        "addressBn": _optional_text(300),
        "addressEn": _optional_text(300),
        "descriptionBn": _optional_text(400),
        "descriptionEn": _optional_text(400),
        "phone": facility_phone.nullable().optional(),
        "emergencyPhone": facility_phone.nullable().optional(),
        "coordinates": z.strict_object(
            {"lat": z.number().min(20).max(27), "lng": z.number().min(87.5).max(93)}
        )
        .nullable()
        .optional(),
    }
).refine(_changes_something, "change at least one field")

rules_body = z.strict_object(
    {
        "noShowGracePatients": z.number().int().min(0).max(20).optional(),
        "noShowGraceMinutes": z.number().int().min(0).max(120).optional(),
        "lateReinsertAfter": z.number().int().min(1).max(20).optional(),
        "staleThresholdMinutes": z.number().int().min(1).max(1_440).optional(),
        "smsBudgetMonthly": z.number().int().min(0).max(10_000_000).nullable().optional(),
        "paymentHoldMinutes": z.number().int().min(5).max(60).optional(),
        "prepayRequired": z.boolean().optional(),
        "noShowPrepay": z.boolean().optional(),
        "noShowWindowDays": z.number().int().min(7).max(365).optional(),
        "arrivalWindows": z.boolean().optional(),
    }
).refine(_changes_something, "change at least one field")

# --- departments ----------------------------------------------------------

department_body = z.strict_object(
    {
        "nameBn": name,
        "nameEn": name,
        "code": z.string().trim().regex(r"^[A-Za-z][A-Za-z0-9-]{1,11}$").transform(lambda value: value.upper()),
        "sortOrder": z.number().int().min(0).max(999).optional(),
    }
)

department_patch_body = z.strict_object(
    {
        "nameBn": name.optional(),
        "nameEn": name.optional(),
        "sortOrder": z.number().int().min(0).max(999).optional(),
    }
).refine(_changes_something, "change at least one field")

# --- doctors --------------------------------------------------------------

bmdc_number = (
    z.string()
    .trim()
    .regex(r"^[A-Za-z]{0,6}-?\d{1,7}$", "a BMDC registration number, e.g. A-12345")
    .transform(lambda value: value.upper())
)

specialty = z.string().trim().regex(r"^[a-z][a-z_-]{1,40}$")

doctor_body = z.strict_object(
    {
        "nameBn": name,
        "nameEn": name,
        "bmdcNumber": bmdc_number,
        "degrees": z.string().trim().min(1).max(300).nullable().optional(),
        "specialties": z.array(specialty).max(5).optional(),
        "defaultConsultMinutes": z.number().int().min(1).max(180).optional(),
        "departmentId": uuid,
        "feePoisha": poisha,
        "room": z.string().trim().min(1).max(40).nullable().optional(),
    }
)

doctor_patch_body = z.strict_object(
    {
        "nameBn": name.optional(),
        "nameEn": name.optional(),
        "degrees": z.string().trim().min(1).max(300).nullable().optional(),
        "defaultConsultMinutes": z.number().int().min(1).max(180).optional(),
        "feePoisha": poisha.optional(),
        "room": z.string().trim().min(1).max(40).nullable().optional(),
        "isActive": z.boolean().optional(),
    }
).refine(_changes_something, "change at least one field")

# --- weekly schedules -----------------------------------------------------

template_body = z.strict_object(
    {
        "doctorHospitalId": uuid,
        "weekday": z.number().int().min(1).max(7),
        "startTime": wall_clock,
        "endTime": wall_clock,
        "capacity": z.number().int().min(1).max(500).nullable().optional(),
    }
).refine(
    lambda body: body["endTime"] > body["startTime"],
    {"message": "the chamber must end after it starts", "path": ["endTime"]},
)

# --- wards and beds -------------------------------------------------------

ward_body = z.strict_object(
    {"nameBn": name, "nameEn": name, "floor": z.number().int().min(0).max(60), "kind": z.enum(list(BED_KINDS))}
)

ward_patch_body = z.strict_object(
    {"nameBn": name.optional(), "nameEn": name.optional(), "floor": z.number().int().min(0).max(60).optional()}
).refine(_changes_something, "change at least one field")

bed_label = z.string().trim().min(1).max(20)

beds_body = z.strict_object(
    {
        "wardId": uuid,
        "labels": z.array(bed_label)
        .min(1)
        .max(200)
        .refine(lambda labels: len({label.lower() for label in labels}) == len(labels), "each label once"),
        "kind": z.enum(list(BED_KINDS)),
        "nightlyPoisha": poisha,
    }
)

bed_patch_body = z.strict_object({"label": bed_label.optional(), "nightlyPoisha": poisha.optional()}).refine(
    _changes_something, "change at least one field"
)

# --- staff ----------------------------------------------------------------

staff_code = z.string().trim().regex(r"^[A-Za-z0-9][A-Za-z0-9-]{0,15}$").transform(lambda value: value.upper())

staff_body = z.strict_object(
    {
        "fullName": name,
        "email": z.string().trim().min(3).max(254).includes("@"),
        "staffCode": staff_code.nullable().optional(),
        "roles": roles,
    }
)

staff_patch_body = z.strict_object(
    {
        "fullName": name.optional(),
        "staffCode": staff_code.nullable().optional(),
        "isActive": z.boolean().optional(),
        "roles": roles.optional(),
    }
).refine(_changes_something, "change at least one field")

# --- what the facility offers in an emergency (FR-EMG-05) -------------------

declared_capabilities_body = z.strict_object(
    {
        "kinds": z.array(z.enum(list(CAPABILITY_KINDS)))
        .max(len(CAPABILITY_KINDS))
        .refine(lambda kinds: len(set(kinds)) == len(kinds), "each kind once")
    }
)

empty_body = z.strict_object({})

# --- onboarding, the platform's side (S-B-12, FR-ONB-*) -----------------------

workspace_body = z.strict_object(
    {
        "code": z.string().trim().regex(r"^[A-Za-z0-9][A-Za-z0-9-]{1,15}$").transform(lambda value: value.upper()),
        "nameBn": name,
        "nameEn": name,
        "kind": z.enum(list(FACILITY_KINDS)),
        "division": z.string().trim().min(2).max(40),
        "district": z.string().trim().min(2).max(60),
        "registrationNo": z.string().trim().min(2).max(60).optional(),
        "adminName": name,
        "adminEmail": z.string().trim().to_lower_case().email().max(254),
    }
)

lifecycle_note_body = z.strict_object({"note": z.string().trim().min(3).max(500).optional()})

agreement_body = z.strict_object(
    {"state": z.enum(list(AGREEMENT_STATES)), "note": z.string().trim().min(3).max(500).nullable().optional()}
)

platform_doctor_params = z.object({"id": uuid, "doctorId": uuid})

#: The out-of-service reason on a bed added from settings, translated by the board.
BED_UNCONFIRMED_REASON = "setup:unconfirmed"

# --- reception desks (FR-REC-32) ------------------------------------------------

desk_body = z.strict_object(
    {
        "nameBn": name,
        "nameEn": name,
        "doctorIds": z.array(z.string().uuid()).max(200).default([]),
        "staffIds": z.array(z.string().uuid()).max(200).default([]),
    }
)

desk_patch_body = z.strict_object(
    {
        "nameBn": name.optional(),
        "nameEn": name.optional(),
        "doctorIds": z.array(z.string().uuid()).max(200).optional(),
        "staffIds": z.array(z.string().uuid()).max(200).optional(),
        "expected": desk_body.optional(),
    }
).refine(lambda body: any(key != "expected" for key in body), "change at least one field")
