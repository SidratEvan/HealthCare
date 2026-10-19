"""The platform's side of onboarding (port of `routes/platform.routes.ts`; S-B-12, FR-ONB-*).

`require_national_role("platform_admin")` on every route but the public
application: a platform administrator belongs to no hospital, so no
hospital's staff reaches anything here, and a government viewer is refused
too. Nothing under this prefix returns a patient, a booking or a record
(FR-ONB-08).
"""

from ..controllers import platform
from ..core.auth import WRITE, require_auth, require_national_role
from ..core.ratelimit import by_ip, rate_limit
from ..core.router import Router
from ..core.validation import validate
from ..domain.schemas import platform as p
from ..domain.schemas import settings as s

routes = Router()

_admin = (require_auth, require_national_role("platform_admin"))
_by_id = s.settings_id_params

#: A hospital applies once: a handful an hour from one address.
_application_limit = rate_limit(limit=5, window_seconds=3_600, key_for=by_ip)

routes.post(
    "/hospital-applications", _application_limit, WRITE, validate(body=p.application_body), platform.post_application
)

routes.get("/platform/hospitals", *_admin, platform.list_workspaces)
routes.get("/platform/hospitals/:id", *_admin, validate(params=_by_id), platform.get_workspace)
routes.get("/platform/hospitals/:id/audit", *_admin, validate(params=_by_id), platform.get_audit_trail)
routes.post("/platform/hospitals", *_admin, WRITE, validate(body=s.workspace_body), platform.post_workspace)

for _path, _action in (
    ("approve", "approve"),
    ("send-back", "send_back"),
    ("suspend", "suspend"),
    ("reinstate", "reinstate"),
    ("close", "close"),
):
    routes.post(
        f"/platform/hospitals/:id/{_path}",
        *_admin,
        WRITE,
        validate(params=_by_id, body=s.lifecycle_note_body),
        platform.post_act(_action),
    )

routes.post(
    "/platform/hospitals/:id/doctors/:doctorId/verify",
    *_admin,
    WRITE,
    validate(params=s.platform_doctor_params, body=s.empty_body),
    platform.post_verify_doctor,
)
routes.post(
    "/platform/hospitals/:id/domain",
    *_admin,
    WRITE,
    validate(params=_by_id, body=p.portal_domain_body),
    platform.post_portal_domain,
)
routes.put(
    "/platform/hospitals/:id/modules", *_admin, WRITE, validate(params=_by_id, body=p.modules_body), platform.put_modules
)
routes.put(
    "/platform/hospitals/:id/agreement",
    *_admin,
    WRITE,
    validate(params=_by_id, body=s.agreement_body),
    platform.put_agreement,
)
