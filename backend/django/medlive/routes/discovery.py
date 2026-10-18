"""Public discovery routes (port of `routes/discovery.routes.ts`): the unauthenticated surface."""

from ..controllers import discovery
from ..core.router import Router
from ..core.validation import validate
from ..domain.schemas import booking as s

routes = Router()

routes.get("/config", validate(query=s.config_query), discovery.get_config)
routes.get("/search", validate(query=s.search_query), discovery.search)
routes.get("/hospitals", validate(query=s.hospital_query), discovery.list_hospitals)
routes.get("/hospitals/:id", validate(params=s.id_params), discovery.get_hospital)
routes.get("/hospitals/:id/logo", validate(params=s.id_params), discovery.get_logo)
routes.get("/hospitals/:id/doctors", validate(params=s.id_params), discovery.get_hospital_doctors)
routes.get("/doctors", validate(query=s.doctor_query), discovery.list_doctors)
routes.get("/doctors/:id", validate(params=s.id_params), discovery.get_doctor)
routes.get("/sessions", validate(query=s.session_query), discovery.list_sessions)
routes.get("/sessions/:id/availability", validate(params=s.id_params), discovery.get_availability)
