"""Admin dashboard routes (port of `routes/admin.routes.ts`; BACKEND.md §7.7, FR-ADM-01..12).

No hospital in the path, on purpose: the controller takes it from the
principal, so a caller cannot name one at all. The export is a GET because
it is a download; the audit row it writes records the read.
"""

from ..controllers import admin
from ..core.auth import require_auth, require_role
from ..core.router import Router
from ..core.schema import z
from ..core.validation import validate

routes = Router()

_date = z.string().regex(r"^\d{4}-\d{2}-\d{2}$")
range_query = z.object({"from": _date.optional(), "to": _date.optional()})
export_query = range_query.extend({"view": z.string().min(1).max(40)})

_admin = (require_auth, require_role("hospital_admin"))

routes.get("/admin/dashboard", *_admin, validate(query=range_query), admin.get_dashboard)
routes.get("/admin/overview", *_admin, admin.get_overview)
routes.get("/admin/export", *_admin, validate(query=export_query), admin.get_export)
