"""Referral routes (port of `routes/referral.routes.ts`; BACKEND.md §7.5, FR-EMG-07..09).

Only an ER coordinator, and only for a referral their hospital is a party
to; which side they are on decides which steps are theirs (the service's
guard, because it depends on the row).
"""

from ..controllers import referral
from ..core.auth import WRITE, require_auth, require_role
from ..core.router import Router
from ..core.validation import validate
from ..domain.schemas import referral as s

routes = Router()

_er = (require_auth, require_role("emergency"))
_step = (*_er, WRITE, validate(params=s.referral_params, body=s.referral_action_body))

routes.post("/referrals", *_er, WRITE, validate(body=s.referral_send_body), referral.send)
routes.post("/referrals/:id/seen", *_step, referral.seen)
routes.post("/referrals/:id/accept", *_step, referral.accept)
routes.post(
    "/referrals/:id/decline",
    *_er,
    WRITE,
    validate(params=s.referral_params, body=s.referral_decline_body),
    referral.decline,
)
routes.post("/referrals/:id/cancel", *_step, referral.cancel)
routes.post("/referrals/:id/arrive", *_step, referral.arrive)
