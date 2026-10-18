"""Queue routes (port of `routes/queue.routes.ts`; BACKEND.md §7.4).

Every write demands an idempotency key: a console replays a shift's actions
when the signal returns (FR-OFF-01, FR-QUE-51).
"""

from ..controllers import queue
from ..core.auth import WRITE, require_auth, require_booking_scope, require_role
from ..core.router import Router
from ..core.validation import validate
from ..domain.schemas import queue as s

routes = Router()

routes.get(
    "/sessions/:id/queue",
    require_auth,
    require_role("receptionist", "doctor", "hospital_admin"),
    validate(params=s.session_params, query=s.queue_query),
    queue.get_queue,
)

routes.post("/sessions/:id/arrived", require_auth, require_role("receptionist", "doctor"), WRITE,
            validate(params=s.session_params, body=s.doctor_arrived_body), queue.declare_arrived)
routes.post("/sessions/:id/delay", require_auth, require_role("receptionist", "doctor"), WRITE,
            validate(params=s.session_params, body=s.declare_delay_body), queue.declare_delay)
routes.post("/sessions/:id/pause", require_auth, require_role("receptionist"), WRITE,
            validate(params=s.session_params, body=s.pause_session_body), queue.pause_session)
routes.post("/sessions/:id/resume", require_auth, require_role("receptionist"), WRITE,
            validate(params=s.session_params, body=s.resume_session_body), queue.resume_session)
routes.post("/sessions/:id/end", require_auth, require_role("receptionist"), WRITE,
            validate(params=s.session_params, body=s.end_session_body), queue.end_session)

# The most-used control in the product (FR-REC-01).
routes.post("/sessions/:id/next", require_auth, require_role("receptionist", "doctor"), WRITE,
            validate(params=s.session_params, body=s.call_next_body), queue.call_next)

routes.post("/bookings/:id/done", require_auth, require_role("receptionist", "doctor"), WRITE,
            validate(params=s.booking_params, body=s.mark_done_body), queue.mark_done)
# Declared by the counter or by the patient (FR-PAT-33); a link acts on its own booking only.
routes.post("/bookings/:id/late", require_auth, require_booking_scope("id"), WRITE,
            validate(params=s.booking_params, body=s.mark_late_body), queue.mark_late)
routes.post("/bookings/:id/no-show", require_auth, require_role("receptionist"), WRITE,
            validate(params=s.booking_params, body=s.mark_no_show_body), queue.mark_no_show)
routes.post("/bookings/:id/reinstate", require_auth, require_role("receptionist"), WRITE,
            validate(params=s.booking_params, body=s.reinstate_body), queue.reinstate)
routes.post("/bookings/:id/check-in", require_auth, require_role("receptionist"), WRITE,
            validate(params=s.booking_params, body=s.check_in_body), queue.check_in)
routes.post("/sessions/:id/walkin", require_auth, require_role("receptionist"), WRITE,
            validate(params=s.session_params, body=s.add_walkin_body), queue.add_walkin)
# Reason mandatory, and recorded (FR-REC-15).
routes.post("/sessions/:id/reorder", require_auth, require_role("receptionist"), WRITE,
            validate(params=s.session_params, body=s.reorder_body), queue.reorder)

# Freed slots and the standby list (FR-QUE-30, FR-REC-30).
routes.get("/sessions/:id/standby", require_auth, require_role("receptionist", "hospital_admin"),
           validate(params=s.session_params), queue.get_standby)
routes.post("/bookings/:id/offer-slot", require_auth, require_role("receptionist"), WRITE,
            validate(params=s.booking_params, body=s.offer_slot_body), queue.offer_slot)
routes.post("/offers/:id/accept", require_auth, require_role("receptionist"), WRITE,
            validate(params=s.offer_params, body=s.accept_offer_body), queue.accept_offer)

# Ten seconds, and only the actor who did it (GR-02).
routes.post("/events/:id/undo", require_auth, WRITE,
            validate(params=s.event_params, body=s.undo_body), queue.undo)
