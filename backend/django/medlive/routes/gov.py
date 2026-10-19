"""The national layer (port of `routes/gov.routes.ts`; BACKEND.md §7.7, FR-GOV-01..06).

`require_national_role`, not `require_role`: a government viewer is not a
hospital's staff, and these routes refuse every other kind of principal, so
neither set of routes can be crossed from the other side (FR-ROLE-04).
"""

from ..controllers import gov
from ..core.auth import require_auth, require_national_role
from ..core.router import Router

routes = Router()

_viewer = (require_auth, require_national_role("gov_viewer"))

routes.get("/gov/capacity", *_viewer, gov.get_capacity)
routes.get("/gov/er-load", *_viewer, gov.get_er_load)
routes.get("/gov/signals", *_viewer, gov.get_signals)
routes.get("/gov/benchmarks", *_viewer, gov.get_benchmarks)
