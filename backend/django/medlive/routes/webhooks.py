"""Provider callbacks (port of `routes/webhooks.routes.ts`; FR-PAY-03, FR-NOT-06)."""

from ..controllers import webhooks
from ..core.router import Router

routes = Router()

routes.post("/webhooks/bkash", webhooks.callback("bkash"))
routes.post("/webhooks/nagad", webhooks.callback("nagad"))
routes.post("/webhooks/sms-dlr", webhooks.sms_delivery)
