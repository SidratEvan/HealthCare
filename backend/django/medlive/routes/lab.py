"""Lab and pharmacy routes (port of `routes/lab.routes.ts`; FR-LAB-01..08, FR-PHA-*, S-B-08).

A report upload parses its own body, up to 14 MB, so a real scan is not
refused by the global limit (base64 of the 10 MB file limit, with room).
"""

from ..controllers import lab
from ..core.auth import WRITE, require_auth, require_hospital_scope, require_role
from ..core.router import Router
from ..core.schema import z
from ..core.validation import validate
from ..domain.schemas import lab as s

routes = Router()

_doctor = (require_auth, require_role("doctor"))
_bench = (require_auth, require_role("lab", "hospital_admin"))
_counter = (require_auth, require_role("pharmacy", "hospital_admin"))
_hospital_params = z.object({"hospitalId": z.string().uuid()})

#: body-parser's '14mb'.
REPORT_BODY_LIMIT = 14 * 1024 * 1024

routes.get("/lab/catalogue", *_doctor, lab.catalogue)
routes.post("/test-orders", *_doctor, WRITE, validate(body=s.create_test_orders_body), lab.order)
routes.get(
    "/hospitals/:hospitalId/test-orders",
    *_bench,
    require_hospital_scope(),
    validate(params=_hospital_params, query=s.lab_queue_query),
    lab.queue,
)
routes.patch(
    "/test-orders/:id/state",
    *_bench,
    WRITE,
    validate(params=s.test_order_params, body=s.test_order_state_body),
    lab.advance,
)
routes.post(
    "/test-orders/:id/report",
    *_bench,
    WRITE,
    validate(params=s.test_order_params, body=s.upload_report_body),
    lab.upload_report,
    body_limit=REPORT_BODY_LIMIT,
)
routes.get("/test-orders/:id/patient", *_bench, validate(params=s.test_order_params), lab.patient_label)
routes.get(
    "/hospitals/:hospitalId/pharmacy-stock",
    *_counter,
    require_hospital_scope(),
    validate(params=_hospital_params),
    lab.shelf,
)
routes.put(
    "/hospitals/:hospitalId/pharmacy-stock",
    *_counter,
    require_hospital_scope(),
    WRITE,
    validate(params=_hospital_params, body=s.stock_flags_body),
    lab.set_flags,
)
routes.get("/medicines", validate(query=s.medicine_search_query), lab.search_medicines)
routes.get("/files/:key", lab.serve_file)
