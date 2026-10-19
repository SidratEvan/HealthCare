"""Standby list routes (port of `routes/standby.routes.ts`; FR-QUE-30..35, FR-PAT-35).

A standby link is its own credential, scoped to one place on one list.
"""

from ..controllers import standby
from ..core.auth import WRITE
from ..core.ratelimit import by_ip, rate_limit
from ..core.router import Router
from ..core.validation import validate
from ..domain.schemas import queue as q
from ..domain.schemas import standby as s

routes = Router()

_join_limit = rate_limit(limit=10, window_seconds=600, key_for=by_ip)

routes.post(
    "/sessions/:id/standby",
    _join_limit,
    WRITE,
    validate(params=q.session_params, body=s.join_standby_body),
    standby.join,
)
routes.get("/standby/:token", validate(params=s.standby_token_params), standby.status)
routes.post(
    "/standby/:token/accept",
    WRITE,
    validate(params=s.standby_token_params, body=s.accept_standby_offer_body),
    standby.accept,
)
routes.post(
    "/standby/:token/decline", WRITE, validate(params=s.standby_token_params, body=s.standby_answer_body), standby.decline
)
routes.post(
    "/standby/:token/leave", WRITE, validate(params=s.standby_token_params, body=s.standby_answer_body), standby.leave
)
