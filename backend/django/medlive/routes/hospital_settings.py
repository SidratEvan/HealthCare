"""`/hospital/*`, a facility's own setup (port of `routes/hospitalSettings.routes.ts`;
BACKEND.md §7.7, S-B-11, FR-SUP-01, FR-ADM-11).

Every route acts on the administrator's own facility; no hospital id is in
any path to tamper with (FR-ROLE-01). Every write takes an idempotency key;
a doubled create meets the schema's unique indexes (`SETTINGS_DUPLICATE`).
"""

from ..controllers import hospital_settings as settings
from ..core.auth import WRITE, require_auth, require_role
from ..core.router import Router
from ..core.validation import validate
from ..domain.brand import brand_body, logo_body, publishing_body
from ..domain.schemas import settings as s

routes = Router()

_admin = (require_auth, require_role("hospital_admin"))
_by_id = s.settings_id_params

#: body-parser's '512kb': a logo in base64 is larger than the API's ordinary limit.
LOGO_BODY_LIMIT = 512 * 1024

routes.get("/hospital/setup", *_admin, settings.get_setup)
routes.get("/hospital/brand", require_auth, settings.get_brand)

routes.get("/hospital/desks", require_auth, settings.get_desks)
routes.post("/hospital/desks", *_admin, WRITE, validate(body=s.desk_body), settings.post_desk)
routes.patch(
    "/hospital/desks/:id", *_admin, WRITE, validate(params=_by_id, body=s.desk_patch_body), settings.patch_desk
)
routes.delete("/hospital/desks/:id", *_admin, WRITE, validate(params=_by_id), settings.delete_desk)

routes.get("/hospital/messages", *_admin, settings.get_messages)

routes.patch("/hospital/profile", *_admin, WRITE, validate(body=s.profile_body), settings.patch_profile)
routes.put("/hospital/brand", *_admin, WRITE, validate(body=brand_body), settings.put_brand)
routes.get("/hospital/logo", *_admin, settings.get_own_logo)
routes.put("/hospital/publishing", *_admin, WRITE, validate(body=publishing_body), settings.put_publishing)
routes.put(
    "/hospital/logo", *_admin, WRITE, validate(body=logo_body), settings.put_logo, body_limit=LOGO_BODY_LIMIT
)
routes.delete("/hospital/logo", *_admin, WRITE, settings.delete_logo)

routes.patch("/hospital/rules", *_admin, WRITE, validate(body=s.rules_body), settings.patch_rules)

routes.post("/hospital/departments", *_admin, WRITE, validate(body=s.department_body), settings.post_department)
routes.patch(
    "/hospital/departments/:id",
    *_admin,
    WRITE,
    validate(params=_by_id, body=s.department_patch_body),
    settings.patch_department,
)
routes.delete("/hospital/departments/:id", *_admin, WRITE, validate(params=_by_id), settings.delete_department)

routes.post("/hospital/doctors", *_admin, WRITE, validate(body=s.doctor_body), settings.post_doctor)
routes.patch(
    "/hospital/doctors/:id", *_admin, WRITE, validate(params=_by_id, body=s.doctor_patch_body), settings.patch_doctor
)

routes.post("/hospital/templates", *_admin, WRITE, validate(body=s.template_body), settings.post_template)
routes.delete("/hospital/templates/:id", *_admin, WRITE, validate(params=_by_id), settings.delete_template)

routes.post("/hospital/wards", *_admin, WRITE, validate(body=s.ward_body), settings.post_ward)
routes.post("/hospital/beds", *_admin, WRITE, validate(body=s.beds_body), settings.post_beds)
routes.patch("/hospital/beds/:id", *_admin, WRITE, validate(params=_by_id, body=s.bed_patch_body), settings.patch_bed)
routes.delete("/hospital/beds/:id", *_admin, WRITE, validate(params=_by_id), settings.delete_bed)
routes.patch(
    "/hospital/wards/:id", *_admin, WRITE, validate(params=_by_id, body=s.ward_patch_body), settings.patch_ward
)
routes.delete("/hospital/wards/:id", *_admin, WRITE, validate(params=_by_id), settings.delete_ward)

routes.post("/hospital/staff", *_admin, WRITE, validate(body=s.staff_body), settings.post_staff)
routes.patch(
    "/hospital/staff/:id", *_admin, WRITE, validate(params=_by_id, body=s.staff_patch_body), settings.patch_staff
)
routes.post(
    "/hospital/staff/:id/reset-password",
    *_admin,
    WRITE,
    validate(params=_by_id, body=s.empty_body),
    settings.post_reset_password,
)
routes.post(
    "/hospital/staff/:id/reset-2fa",
    *_admin,
    WRITE,
    validate(params=_by_id, body=s.empty_body),
    settings.post_reset_two_factor,
)

routes.put(
    "/hospital/capabilities", *_admin, WRITE, validate(body=s.declared_capabilities_body), settings.put_capabilities
)

# FR-ONB-04: the hospital asks, the platform answers; no route publishes a hospital itself.
routes.post("/hospital/request-review", *_admin, WRITE, validate(body=s.empty_body), settings.post_request_review)
