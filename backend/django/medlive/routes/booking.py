"""Booking routes (port of `routes/booking.routes.ts`; FR-PAT-20, FR-GST-01, FR-GST-05).

Booking needs no account: a guest books with a phone and gets a signed
tracking link (`FR-GST-01`). The address limit keeps one machine from
filling a chamber.
"""

from ..controllers import booking
from ..core.auth import WRITE, require_auth, require_booking_scope
from ..core.ratelimit import by_ip, rate_limit
from ..core.router import Router
from ..core.validation import validate
from ..domain.schemas import booking as s
from ..domain.schemas import queue as q

routes = Router()

_booking_limit = rate_limit(limit=300, window_seconds=3_600, key_for=by_ip)
_link_limit = rate_limit(limit=120, window_seconds=3_600, key_for=by_ip)

routes.post("/bookings", _booking_limit, WRITE, validate(body=s.create_booking_body), booking.create_booking)
routes.get(
    "/bookings/:id", require_auth, require_booking_scope("id"), validate(params=s.id_params), booking.get_booking
)
routes.post(
    "/bookings/:id/cancel",
    require_auth,
    require_booking_scope("id"),
    WRITE,
    validate(params=s.id_params, body=q.cancel_booking_body),
    booking.cancel_booking,
)
routes.get("/me/bookings", require_auth, booking.my_bookings)
routes.post(
    "/me/bookings/:id/link", require_auth, _link_limit, WRITE, validate(params=s.id_params), booking.my_booking_link
)
