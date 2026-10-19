"""Emergency routes (port of `routes/emergency.routes.ts`; FR-ER-*, S-B-07).

The search and a family's alert need no account; the alert is rate limited
by address, and its tracking link is its own credential.
"""

from ..controllers import emergency
from ..core.auth import WRITE, require_auth, require_hospital_scope, require_role
from ..core.ratelimit import by_ip, rate_limit
from ..core.router import Router
from ..core.validation import validate
from ..domain.schemas import emergency as s

routes = Router()

_er = (require_auth, require_role("emergency"))
_alert_limit = rate_limit(limit=10, window_seconds=600, key_for=by_ip)

routes.get("/emergency/search", validate(query=s.emergency_search_query), emergency.search)
routes.post("/emergency/inbound", _alert_limit, WRITE, validate(body=s.inbound_body), emergency.inbound)
routes.get("/emergency/track/:token", validate(params=s.emergency_token_params), emergency.track)
routes.post("/emergency/track/:token/cancel", validate(params=s.emergency_token_params), emergency.cancel)
routes.get(
    "/hospitals/:id/emergency",
    require_auth,
    require_role("emergency", "hospital_admin"),
    require_hospital_scope("id"),
    validate(params=s.hospital_emergency_params),
    emergency.board,
)
routes.get("/emergency/cases/:id/contact", *_er, validate(params=s.emergency_case_params), emergency.contact)
routes.post("/emergency/cases", *_er, WRITE, validate(body=s.walk_in_body), emergency.walk_in)
routes.post(
    "/emergency/cases/:id/acknowledge",
    *_er,
    WRITE,
    validate(params=s.emergency_case_params, body=s.acknowledge_body),
    emergency.acknowledge,
)
routes.patch(
    "/emergency/cases/:id",
    *_er,
    WRITE,
    validate(params=s.emergency_case_params, body=s.case_command_body),
    emergency.update,
)
routes.put(
    "/hospitals/:id/capabilities",
    require_auth,
    require_role("emergency", "hospital_admin"),
    require_hospital_scope("id"),
    WRITE,
    validate(params=s.hospital_emergency_params, body=s.capabilities_body),
    emergency.capabilities,
)
