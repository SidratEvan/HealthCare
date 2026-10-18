"""Room names, and who may be in each (port of `realtime/rooms.ts`, BACKEND.md §6).

Names are built here and nowhere else: a room name typed by hand in a service
is one typo from a broadcast that reaches nobody, silently.
"""

from __future__ import annotations

from ..core.principal import Principal


class ROOMS:
    @staticmethod
    def session(session_id: str) -> str:
        """Patients with a booking in the chamber: the patients' copy, naming nobody."""
        return f"session:{session_id}"

    @staticmethod
    def session_staff(session_id: str) -> str:
        """The chamber's reception console and doctor's screen."""
        return f"session:{session_id}:staff"

    @staticmethod
    def beds(hospital_id: str) -> str:
        return f"hospital:{hospital_id}:beds"

    @staticmethod
    def emergency(hospital_id: str) -> str:
        return f"hospital:{hospital_id}:emergency"

    @staticmethod
    def lab(hospital_id: str) -> str:
        return f"hospital:{hospital_id}:lab"

    @staticmethod
    def admin(hospital_id: str) -> str:
        return f"hospital:{hospital_id}:admin"

    @staticmethod
    def patient(patient_id: str) -> str:
        return f"patient:{patient_id}"


_SESSION_ROLES = ("receptionist", "doctor", "hospital_admin")


def can_join_session(principal: Principal | None, *, hospital_id: str, holds_booking: bool) -> bool:
    """Staff of the hospital running it, or a person holding a booking in it."""
    if principal is None:
        return False
    if principal.kind == "staff":
        return principal.hospital_id == hospital_id and any(r in _SESSION_ROLES for r in principal.roles)
    if principal.kind in ("patient", "guest"):
        return holds_booking
    # A national principal reads aggregates over HTTP and has no room (FR-GOV-06).
    return False


_AMBIENT = (
    ("beds", ("ward", "emergency", "receptionist", "doctor", "hospital_admin"), ROOMS.beds),
    ("emergency", ("emergency", "hospital_admin"), ROOMS.emergency),
    ("lab", ("lab", "hospital_admin"), ROOMS.lab),
    ("dashboard", ("hospital_admin",), ROOMS.admin),
)


def ambient_rooms_for(principal: Principal, off: tuple[str, ...] | list[str] = ()) -> list[str]:
    """A console's own hospital boards, by role and module; nothing for anyone else."""
    if principal.kind != "staff":
        return []
    hospital_id = principal.hospital_id or ""
    return [
        room(hospital_id)
        for module, roles, room in _AMBIENT
        if module not in off and any(role in roles for role in principal.roles)
    ]
