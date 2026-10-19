"""Clinical routes (port of `routes/clinical.routes.ts`; FR-DOC-*, FR-PAT-40, FR-PAT-6x).

A patient's own paper parses its own body, up to 12 MB: base64 of the
8 MB document limit, with room.
"""

from ..controllers import clinical
from ..core.auth import WRITE, require_auth, require_role
from ..core.router import Router
from ..core.validation import validate
from ..domain.schemas import clinical as s
from ..domain.schemas.booking import id_params

routes = Router()

_doctor = (require_auth, require_role("doctor"))

#: body-parser's '12mb'.
DOCUMENT_BODY_LIMIT = 12 * 1024 * 1024

routes.get("/visits/booking/:id", *_doctor, validate(params=id_params), clinical.get_consultation)
routes.get(
    "/patients/:id/records", require_auth, validate(params=id_params, query=s.records_query), clinical.get_records
)
routes.post("/visits", *_doctor, WRITE, validate(body=s.create_visit_body), clinical.create_visit)
routes.get("/formulary", *_doctor, validate(query=s.formulary_query), clinical.search_formulary)
routes.post(
    "/me/documents",
    require_auth,
    WRITE,
    validate(body=s.upload_document_body),
    clinical.upload_document,
    body_limit=DOCUMENT_BODY_LIMIT,
)
routes.get("/me/documents", require_auth, validate(query=s.documents_query), clinical.list_documents)
routes.delete("/me/documents/:id", require_auth, validate(params=s.document_id_params), clinical.remove_document)
routes.get(
    "/patients/:id/documents/:docId/url",
    require_auth,
    validate(params=s.document_url_params),
    clinical.document_url,
)
