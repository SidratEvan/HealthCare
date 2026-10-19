"""Counter registration routes (port of `routes/registration.routes.ts`; S-B-03, FR-REC-14)."""

from ..controllers import registration
from ..core.auth import WRITE, require_auth, require_role
from ..core.router import Router
from ..core.validation import validate
from ..domain.schemas import registration as s

routes = Router()

_reception = (require_auth, require_role("receptionist"))

routes.get(
    "/registration/patients", *_reception, validate(query=s.registration_lookup_query), registration.lookup
)
routes.post(
    "/registration/patients", *_reception, WRITE, validate(body=s.register_patient_body), registration.register
)
