"""Hospital modules (`FR-BRD-11`, plan C4; port of `shared/domain/src/modules/modules.ts`).

A hospital switches modules off; a member of staff reaches only the modules
their hospital runs. `MODULE_ROUTES` says which module each staff request
belongs to, and is generated from the TypeScript table.
"""

from __future__ import annotations

import re

HOSPITAL_MODULES: tuple[str, ...] = (
    "queue",
    "doctor",
    "beds",
    "emergency",
    "lab",
    "pharmacy",
    "dashboard",
    "import",
)


def is_hospital_module(value: str) -> bool:
    return value in HOSPITAL_MODULES


MODULE_OF_ROLE: dict[str, str | None] = {
    "receptionist": "queue",
    "doctor": "doctor",
    "ward": "beds",
    "emergency": "emergency",
    "lab": "lab",
    "pharmacy": "pharmacy",
    "hospital_admin": None,
}


def modules_problems(off: list[str] | tuple[str, ...]) -> list[str]:
    return ["doctor_needs_queue"] if "queue" in off and "doctor" not in off else []


def module_on(off: list[str] | tuple[str, ...], module: str) -> bool:
    return module not in off


MODULE_ROUTES: dict[str, tuple[str, ...]] = {
    "GET /sessions/:id/queue": ("queue",),
    "POST /sessions/:id/arrived": ("queue",),
    "POST /sessions/:id/delay": ("queue",),
    "POST /sessions/:id/pause": ("queue",),
    "POST /sessions/:id/resume": ("queue",),
    "POST /sessions/:id/end": ("queue",),
    "POST /sessions/:id/next": ("queue",),
    "POST /sessions/:id/walkin": ("queue",),
    "POST /sessions/:id/reorder": ("queue",),
    "GET /sessions/:id/standby": ("queue",),
    "POST /bookings/:id/done": ("queue",),
    "POST /bookings/:id/no-show": ("queue",),
    "POST /bookings/:id/reinstate": ("queue",),
    "POST /bookings/:id/check-in": ("queue",),
    "POST /bookings/:id/offer-slot": ("queue",),
    "POST /offers/:id/accept": ("queue",),
    "POST /sync/events": ("queue",),
    "GET /sync/session/:id": ("queue",),
    "GET /bookings/:id": ("queue",),
    "GET /bookings/:id/payments": ("queue",),
    "POST /bookings/:id/payments/:paymentId/confirm": ("queue",),
    "POST /bookings/:id/late": ("queue",),
    "POST /bookings/:id/cancel": ("queue",),
    "POST /events/:id/undo": ("queue",),
    "GET /registration/patients": ("queue",),
    "POST /registration/patients": ("queue",),
    "POST /visits": ("doctor",),
    "GET /visits/booking/:id": ("doctor",),
    "GET /patients/:id/records": ("doctor",),
    "POST /consents/qr": ("doctor",),
    "GET /formulary": ("doctor",),
    "GET /lab/catalogue": ("doctor", "lab"),
    "POST /test-orders": ("doctor", "lab"),
    "GET /hospitals/:id/beds": ("beds",),
    "GET /hospitals/:id/bed-requests": ("beds",),
    "GET /beds/:id": ("beds",),
    "POST /beds/:id/admit": ("beds",),
    "POST /beds/:id/discharge": ("beds",),
    "POST /beds/:id/transfer": ("beds",),
    "POST /beds/:id/reserve": ("beds",),
    "POST /beds/:id/release": ("beds",),
    "POST /beds/:id/clean-start": ("beds",),
    "POST /beds/:id/clean-done": ("beds",),
    "POST /beds/:id/oos": ("beds",),
    "POST /beds/:id/restore": ("beds",),
    "POST /beds/:id/expected-discharge": ("beds",),
    "POST /bed-requests/:id/respond": ("beds",),
    "POST /hospital/wards": ("beds",),
    "PATCH /hospital/wards/:id": ("beds",),
    "DELETE /hospital/wards/:id": ("beds",),
    "POST /hospital/beds": ("beds",),
    "PATCH /hospital/beds/:id": ("beds",),
    "DELETE /hospital/beds/:id": ("beds",),
    "GET /hospitals/:id/emergency": ("emergency",),
    "PUT /hospitals/:id/capabilities": ("emergency",),
    "POST /emergency/cases": ("emergency",),
    "GET /emergency/cases/:id/contact": ("emergency",),
    "POST /emergency/cases/:id/acknowledge": ("emergency",),
    "PATCH /emergency/cases/:id": ("emergency",),
    "POST /referrals": ("emergency",),
    "POST /referrals/:id/seen": ("emergency",),
    "POST /referrals/:id/accept": ("emergency",),
    "POST /referrals/:id/decline": ("emergency",),
    "POST /referrals/:id/cancel": ("emergency",),
    "POST /referrals/:id/arrive": ("emergency",),
    "PUT /hospital/capabilities": ("emergency",),
    "GET /hospitals/:hospitalId/test-orders": ("lab",),
    "PATCH /test-orders/:id/state": ("lab",),
    "POST /test-orders/:id/report": ("lab",),
    "GET /test-orders/:id/patient": ("lab",),
    "GET /hospitals/:hospitalId/pharmacy-stock": ("pharmacy",),
    "PUT /hospitals/:hospitalId/pharmacy-stock": ("pharmacy",),
    "GET /admin/dashboard": ("dashboard",),
    "GET /admin/overview": ("dashboard",),
    "GET /admin/export": ("dashboard",),
    "GET /hospitals/:hospitalId/settlement": ("dashboard",),
    "POST /payments/:id/refund": ("dashboard",),
    "GET /payments/:id/history": ("dashboard",),
    "GET /hospital/imports/templates/:set": ("import",),
    "GET /hospital/imports": ("import",),
    "GET /hospital/imports/:id": ("import",),
    "POST /hospital/imports": ("import",),
    "POST /hospital/imports/analyse": ("import",),
    "POST /hospital/imports/mapped": ("import",),
    "POST /hospital/imports/:id/commit": ("import",),
    "POST /hospital/imports/:id/undo": ("import",),
    "POST /hospital/imports/:id/discard": ("import",),}


def _compile(key: str) -> tuple[str, re.Pattern[str], int]:
    method, path = key.split(" ", 1)
    parts = ["[^/]+" if part.startswith(":") else re.escape(part) for part in path.split("/")]
    source = "/".join(parts)
    return method, re.compile(f"^{source}/?$"), source.count("[^/]+")


_COMPILED = [(*_compile(key), modules) for key, modules in MODULE_ROUTES.items()]


def modules_of_request(method: str, path: str) -> tuple[str, ...]:
    """The modules a staff request needs; the most specific pattern wins.

    Case-sensitive, as the TypeScript's regular expressions are.
    """
    wanted = method.upper()
    best: tuple[int, tuple[str, ...]] | None = None
    for entry_method, pattern, params, modules in _COMPILED:
        if entry_method != wanted or not pattern.fullmatch(path):
            continue
        if best is None or params < best[0]:
            best = (params, modules)
    return best[1] if best is not None else ()
