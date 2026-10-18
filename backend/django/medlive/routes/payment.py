"""Payment routes (port of `routes/payment.routes.ts`; FR-PAY-01..10, FR-SUP-04)."""

from ..controllers import payment
from ..core.auth import WRITE, require_auth, require_booking_scope, require_hospital_scope, require_role
from ..core.router import Router
from ..core.schema import z
from ..core.validation import validate
from ..domain.schemas import booking as b
from ..domain.schemas import payment as s

routes = Router()

_admin = (require_auth, require_role("hospital_admin"))
_hospital_params = z.object({"hospitalId": z.string().uuid()})

routes.post("/payments/intent", require_auth, WRITE, validate(body=s.payment_intent_body), payment.intent)
routes.get(
    "/bookings/:id/payments", require_auth, require_booking_scope("id"), validate(params=b.id_params), payment.for_booking
)
routes.post(
    "/bookings/:id/payments/:paymentId/confirm",
    require_auth,
    require_booking_scope("id"),
    validate(params=s.payment_confirm_params, body=s.payment_confirm_body),
    payment.confirm,
)
routes.get("/payments/:id/history", *_admin, validate(params=s.payment_params), payment.history)
routes.post(
    "/payments/:id/refund", *_admin, WRITE, validate(params=s.payment_params, body=s.refund_body), payment.refund
)
routes.get(
    "/hospitals/:hospitalId/settlement",
    *_admin,
    require_hospital_scope(),
    validate(params=_hospital_params, query=s.settlement_query),
    payment.settlement,
)
