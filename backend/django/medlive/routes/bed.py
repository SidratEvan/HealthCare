"""Ward board routes (port of `routes/bed.routes.ts`; FR-BED-*, S-B-06).

A family's bed request needs no account and is rate limited by address; its
tracking link is its own credential.
"""

from ..controllers import bed
from ..core.auth import WRITE, require_auth, require_hospital_scope, require_role
from ..core.ratelimit import by_ip, rate_limit
from ..core.router import Router
from ..core.validation import validate
from ..domain.schemas import bed as s

routes = Router()

_ward = (require_auth, require_role("ward"))

routes.get(
    "/hospitals/:id/beds",
    require_auth,
    require_role("ward", "emergency", "receptionist", "doctor", "hospital_admin"),
    require_hospital_scope("id"),
    validate(params=s.hospital_beds_params),
    bed.get_board,
)
routes.get("/beds/:id", *_ward, validate(params=s.bed_params), bed.get_bed)
routes.get(
    "/hospitals/:id/bed-requests",
    *_ward,
    require_hospital_scope("id"),
    validate(params=s.hospital_beds_params),
    bed.pending_requests,
)

for _path, _body, _handler in (
    ("/beds/:id/admit", s.admit_bed_body, bed.admit),
    ("/beds/:id/discharge", s.discharge_bed_body, bed.discharge),
    ("/beds/:id/transfer", s.transfer_bed_body, bed.transfer),
    ("/beds/:id/reserve", s.reserve_bed_body, bed.reserve),
    ("/beds/:id/release", s.release_bed_body, bed.release),
    ("/beds/:id/clean-start", s.clean_start_body, bed.clean_start),
    ("/beds/:id/clean-done", s.clean_done_body, bed.clean_done),
    ("/beds/:id/oos", s.out_of_service_body, bed.out_of_service),
    ("/beds/:id/restore", s.restore_bed_body, bed.restore),
    ("/beds/:id/expected-discharge", s.expected_discharge_body, bed.forecast_discharge),
):
    routes.post(_path, *_ward, WRITE, validate(params=s.bed_params, body=_body), _handler)

_bed_request_limit = rate_limit(limit=10, window_seconds=600, key_for=by_ip)

routes.post("/bed-requests", _bed_request_limit, WRITE, validate(body=s.create_bed_request_body), bed.create_request)
routes.get("/bed-requests/track/:token", validate(params=s.bed_request_token_params), bed.track_request)
routes.post(
    "/bed-requests/:id/respond",
    *_ward,
    WRITE,
    validate(params=s.bed_params, body=s.respond_bed_request_body),
    bed.respond,
)
