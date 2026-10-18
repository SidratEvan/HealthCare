"""What the pipeline attaches to a request (port of `types/express.d.ts`).

A principal is one of four kinds. Every hospital guard asks `kind == "staff"`
first, so a national principal fails all of them without any of them having
to know it exists (`FR-ROLE-04`).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Principal:
    #: "patient" | "guest" | "staff" | "national"
    kind: str
    id: str
    #: staff only (FR-ROLE-01)
    hospital_id: str | None = None
    #: staff and national
    roles: tuple[str, ...] = ()
    #: guest only: the one booking a tracking link may see (FR-GST-05)
    booking_id: str | None = None

    def to_json(self) -> dict[str, object]:
        if self.kind == "staff":
            return {
                "kind": "staff",
                "id": self.id,
                "hospitalId": self.hospital_id,
                "roles": list(self.roles),
            }
        if self.kind == "national":
            return {"kind": "national", "id": self.id, "roles": list(self.roles)}
        if self.kind == "guest":
            return {"kind": "guest", "id": self.id, "bookingId": self.booking_id}
        return {"kind": "patient", "id": self.id}
