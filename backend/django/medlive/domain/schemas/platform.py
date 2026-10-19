"""Request shapes of the platform's side of onboarding (ports of `org/application.ts`
`applicationBody`, `modules/modules.ts` `modulesBody` and `brand/portal.ts`
`portalDomainBody`; FR-ONB-09, FR-BRD-07, FR-BRD-11)."""

from __future__ import annotations

from ...core.schema import z
from ..enums import APPLICABLE_FACILITY_KINDS
from ..modules import HOSPITAL_MODULES
from ..org import APPLICATION_PASSWORD_MIN
from ..portal import HOST_NAME, IPV4
from .booking import bd_phone

_name = z.string().trim().min(2).max(120)
_facility_phone = z.string().trim().regex(r"^\+880[0-9]{8,11}$", "must start +880, e.g. +8802912345678")

application_body = z.strict_object(
    {
        "nameBn": _name,
        "nameEn": _name,
        # Never `chamber` (FR-ONB-11): the platform creates an approved chamber itself.
        "kind": z.enum(list(APPLICABLE_FACILITY_KINDS)),
        "division": z.string().trim().min(2).max(40),
        "district": z.string().trim().min(2).max(60),
        "phone": _facility_phone,
        "registrationNo": z.string().trim().min(2).max(60),
        "adminName": _name,
        "adminEmail": z.string().trim().to_lower_case().email().max(254),
        "adminMobile": bd_phone,
        "password": z.string().min(APPLICATION_PASSWORD_MIN).max(200),
    }
)

modules_body = z.strict_object(
    {
        "off": z.array(z.enum(list(HOSPITAL_MODULES)))
        .max(len(HOSPITAL_MODULES))
        .refine(lambda values: len(set(values)) == len(values), "each module once")
    }
)

portal_domain = (
    z.string()
    .trim()
    .to_lower_case()
    .max(253)
    .refine(
        lambda value: HOST_NAME.fullmatch(value) is not None
        and IPV4.fullmatch(value) is None
        and not value.endswith(".localhost"),
        "must be a domain name, e.g. portal.example-hospital.com.bd",
    )
)

portal_domain_body = z.strict_object({"domain": portal_domain.nullable()})
