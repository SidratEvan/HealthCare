"""Every enumerated value in one place (port of `shared/domain/src/types/enums.ts`).

Generated from the TypeScript; `tests/domain/test_enums.py` holds the two equal.
"""

from __future__ import annotations

USER_KINDS: tuple[str, ...] = ("patient", "guest", "staff", "platform")
SEXES: tuple[str, ...] = ("male", "female", "other")
STAFF_ROLES: tuple[str, ...] = ("receptionist", "doctor", "ward", "emergency", "lab", "pharmacy", "hospital_admin", "platform_admin", "gov_viewer")
FACILITY_KINDS: tuple[str, ...] = ("hospital", "clinic", "diagnostic", "government", "chamber")
APPLICABLE_FACILITY_KINDS: tuple[str, ...] = ("hospital", "clinic", "diagnostic", "government")
SESSION_STATUSES: tuple[str, ...] = ("scheduled", "running", "paused", "ended", "cancelled")
BOOKING_STATUSES: tuple[str, ...] = ("booked", "waiting", "in_chamber", "done", "late", "no_show", "cancelled", "rescheduled")
BOOKING_SOURCES: tuple[str, ...] = ("app", "guest_link", "counter", "phone", "walkin", "import")
QUEUE_EVENT_TYPES: tuple[str, ...] = ("SESSION_OPENED", "DOCTOR_ARRIVED", "DELAY_DECLARED", "SESSION_PAUSED", "SESSION_RESUMED", "PATIENT_CALLED", "PATIENT_DONE", "PATIENT_LATE", "PATIENT_NO_SHOW", "PATIENT_REINSERTED", "PATIENT_ARRIVED", "WALKIN_ADDED", "BOOKING_CANCELLED", "SLOT_OFFERED", "SLOT_ACCEPTED", "SLOT_EXPIRED", "PRIORITY_REORDERED", "SESSION_ENDED", "ACTION_UNDONE")
BED_KINDS: tuple[str, ...] = ("general", "cabin", "hdu", "icu", "ccu", "nicu", "isolation", "burn")
BED_STATES: tuple[str, ...] = ("free", "occupied", "cleaning", "reserved", "out_of_service")
TRIAGE_COLORS: tuple[str, ...] = ("red", "yellow", "green")
EMERGENCY_STATES: tuple[str, ...] = ("inbound", "acknowledged", "arrived", "in_treatment", "admitted", "discharged", "referred", "declined", "cancelled")
EMERGENCY_PROBLEMS: tuple[str, ...] = ("burn", "accident", "cardiac", "stroke", "breathing", "child", "obstetric", "other")
REFERRAL_STATES: tuple[str, ...] = ("sent", "seen", "accepted", "declined", "arrived", "cancelled")
TEST_STATES: tuple[str, ...] = ("ordered", "sample_collected", "processing", "report_ready", "delivered", "cancelled")
AMBULANCE_KINDS: tuple[str, ...] = ("basic", "als", "freezer")
AMBULANCE_STATES: tuple[str, ...] = ("requested", "quoted", "dispatched", "arrived", "completed", "cancelled")
BLOOD_GROUPS: tuple[str, ...] = ("A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-")
BLOOD_REQUEST_STATES: tuple[str, ...] = ("open", "matched", "fulfilled", "cancelled")
PAYMENT_METHODS: tuple[str, ...] = ("bkash", "nagad", "card", "cash", "at_hospital")
PAYMENT_STATES: tuple[str, ...] = ("pending", "paid", "failed", "refunded", "partially_refunded")
NOTIF_CHANNELS: tuple[str, ...] = ("push", "sms", "ivr", "in_app")
NOTIF_STATES: tuple[str, ...] = ("queued", "sent", "delivered", "failed", "skipped")
CAPABILITY_KINDS: tuple[str, ...] = ("burn_unit", "cardiac", "cath_lab", "stroke", "dialysis", "nicu", "trauma_ot", "blood_bank", "ambulance", "isolation")
CONSENT_SCOPES: tuple[str, ...] = ("visit", "hospital", "doctor", "full")
SYMPTOM_SIGNALS: tuple[str, ...] = ("dengue", "diarrhoeal", "fever")
NATIONAL_ROLES: tuple[str, ...] = ("platform_admin", "gov_viewer")
TWO_FACTOR_REQUIRED_ROLES: tuple[str, ...] = ("hospital_admin", "platform_admin")
LOCALES: tuple[str, ...] = ("bn", "en")
IMPORT_SET_KINDS: tuple[str, ...] = ("structure", "patients", "appointments", "records")
IMPORT_STATES: tuple[str, ...] = ("checked", "committed", "undone", "discarded")
EXTERNAL_KINDS: tuple[str, ...] = ("patient", "appointment", "department", "doctor", "schedule", "ward", "bed", "staff")
ORG_LIFECYCLES: tuple[str, ...] = ("setup", "ready_for_review", "active", "suspended", "closed")
AGREEMENT_STATES: tuple[str, ...] = ("trial", "active", "overdue", "ended")
ACTIVE_BOOKING_STATUSES: tuple[str, ...] = ("booked", "waiting", "in_chamber", "late")
SETTLED_BOOKING_STATUSES: tuple[str, ...] = ("done", "no_show", "cancelled", "rescheduled")

DATABASE_ENUMS: dict[str, tuple[str, ...]] = {
    "user_kind": USER_KINDS,
    "sex": SEXES,
    "staff_role": STAFF_ROLES,
    "facility_kind": FACILITY_KINDS,
    "session_status": SESSION_STATUSES,
    "booking_status": BOOKING_STATUSES,
    "booking_source": BOOKING_SOURCES,
    "queue_event_type": QUEUE_EVENT_TYPES,
    "bed_kind": BED_KINDS,
    "bed_state": BED_STATES,
    "triage_color": TRIAGE_COLORS,
    "emergency_state": EMERGENCY_STATES,
    "referral_state": REFERRAL_STATES,
    "test_state": TEST_STATES,
    "ambulance_kind": AMBULANCE_KINDS,
    "ambulance_state": AMBULANCE_STATES,
    "blood_group": BLOOD_GROUPS,
    "blood_request_state": BLOOD_REQUEST_STATES,
    "payment_method": PAYMENT_METHODS,
    "payment_state": PAYMENT_STATES,
    "notif_channel": NOTIF_CHANNELS,
    "notif_state": NOTIF_STATES,
    "capability_kind": CAPABILITY_KINDS,
    "consent_scope": CONSENT_SCOPES,
    "symptom_signal": SYMPTOM_SIGNALS,
    "import_set": IMPORT_SET_KINDS,
    "import_state": IMPORT_STATES,
    "external_kind": EXTERNAL_KINDS,
    "org_lifecycle": ORG_LIFECYCLES,
    "agreement_state": AGREEMENT_STATES,
}


def is_active_booking_status(status: str) -> bool:
    return status in ACTIVE_BOOKING_STATUSES
