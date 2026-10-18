"""Who is asking, and whether they may (port of `middleware/auth.ts`,
`guestAuth.ts`, `requireRole.ts` and `idempotency.ts`).

`attach_principal` reads a token if one is present and moves on if not; a
route that needs a caller says so with `require_auth`. A malformed or expired
token is refused rather than ignored. Every guard fails closed.
"""

from __future__ import annotations

import re
from typing import Callable

from ..domain.enums import NATIONAL_ROLES, STAFF_ROLES
from .errors import AppError, auth_required, forbidden_scope, token_invalid
from .http import ApiRequest
from .jwt import verify_token
from .principal import Principal

Step = Callable[[ApiRequest], None]

_BEARER = re.compile(r"Bearer (.+)", re.IGNORECASE)

#: What a token with `mcp` (must change password) may still reach.
PASSWORD_CHANGE_ALLOWED = frozenset({"/api/v1/staff/password", "/api/v1/staff/me", "/api/v1/staff/logout"})
#: What a token with `tfa: "setup"` may still reach.
TWO_FACTOR_SETUP_ALLOWED = frozenset(
    {"/api/v1/staff/2fa/setup", "/api/v1/staff/2fa/enable", "/api/v1/staff/me", "/api/v1/staff/logout"}
)

UNSCOPED_ROLES = ("platform_admin", "gov_viewer")


def _path_of(req: ApiRequest) -> str:
    return req.path.rstrip("/")


def to_principal(claims: dict) -> Principal | None:
    kind = claims.get("kind")
    sub = claims["sub"]
    if kind == "patient":
        return Principal(kind="patient", id=sub)
    if kind == "guest":
        booking = claims.get("bookingId")
        return Principal(kind="guest", id=sub, booking_id=booking if isinstance(booking, str) else None)
    if kind == "staff":
        roles_claim = claims.get("roles")
        roles = (
            tuple(r for r in roles_claim if isinstance(r, str) and r in STAFF_ROLES)
            if isinstance(roles_claim, list)
            else ()
        )
        if not roles:
            return None
        hospital_id = claims.get("hospitalId")
        if not isinstance(hospital_id, str) or hospital_id == "":
            national = tuple(r for r in roles if r in NATIONAL_ROLES)
            if len(national) != len(roles):
                return None
            return Principal(kind="national", id=sub, roles=national)
        return Principal(kind="staff", id=sub, hospital_id=hospital_id, roles=roles)
    return None


def attach_principal(req: ApiRequest) -> None:
    header = req.get("authorization")
    if header is None or header == "":
        return
    match = _BEARER.fullmatch(header)
    if match is None or match.group(1) == "":
        raise token_invalid("malformed_authorization_header")
    result = verify_token(match.group(1), "access")
    if not result.ok:
        raise token_invalid(result.reason)  # type: ignore[union-attr]
    claims = result.claims  # type: ignore[union-attr]
    principal = to_principal(claims)
    if principal is None:
        raise token_invalid("incomplete_claims")

    if claims.get("kind") == "staff":
        # Imported here: the service imports repositories, which import core.
        from ..services.staff_access import staff_access_live

        sid = claims.get("sid")
        if not staff_access_live(claims["sub"], sid if isinstance(sid, str) else None):
            raise token_invalid("revoked")

    if claims.get("mcp") is True and _path_of(req) not in PASSWORD_CHANGE_ALLOWED:
        raise AppError("AUTH_PASSWORD_CHANGE_REQUIRED")
    if claims.get("tfa") == "setup" and _path_of(req) not in TWO_FACTOR_SETUP_ALLOWED:
        raise AppError("AUTH_2FA_SETUP_REQUIRED")

    req.principal = principal


def _guest_token(req: ApiRequest) -> str | None:
    header = req.get("x-guest-token")
    if header:
        return header
    query = req.query_raw.get("token")
    if isinstance(query, str) and query != "":
        return query
    return None


def attach_guest_from_link(req: ApiRequest) -> None:
    """A tracking-link token (`FR-GST-05`); an expired one is `GUEST_LINK_EXPIRED`."""
    token = _guest_token(req)
    if token is None:
        return
    result = verify_token(token, "guest")
    if not result.ok:
        reason = result.reason  # type: ignore[union-attr]
        if reason == "expired":
            raise AppError("GUEST_LINK_EXPIRED")
        raise token_invalid(f"guest_link_{reason}")
    claims = result.claims  # type: ignore[union-attr]
    booking_id = claims.get("bookingId")
    if not isinstance(booking_id, str) or booking_id == "":
        raise token_invalid("guest_link_missing_booking_scope")
    if req.principal is None:
        req.principal = Principal(kind="guest", id=claims["sub"], booking_id=booking_id)


def require_auth(req: ApiRequest) -> None:
    if req.principal is None:
        raise auth_required()


def require_role(*roles: str) -> Step:
    if not roles:
        raise ValueError("require_role needs at least one role; an empty list would allow everyone.")

    def step(req: ApiRequest) -> None:
        principal = req.principal
        if principal is None:
            raise auth_required()
        if principal.kind != "staff":
            raise forbidden_scope({"needed": list(roles), "was": principal.kind})
        if not any(role in principal.roles for role in roles):
            raise forbidden_scope({"needed": list(roles)})

    return step


def is_unscoped(principal: Principal) -> bool:
    return all(role in UNSCOPED_ROLES for role in principal.roles)


def require_hospital_scope(param: str = "hospitalId") -> Step:
    def step(req: ApiRequest) -> None:
        principal = req.principal
        if principal is None:
            raise auth_required()
        if principal.kind != "staff":
            raise forbidden_scope({"was": principal.kind})
        if is_unscoped(principal):
            return
        target = req.params.get(param) if isinstance(req.params, dict) else None
        if not isinstance(target, str) or target == "":
            raise forbidden_scope({"reason": "missing_hospital_parameter", "param": param})
        if target != principal.hospital_id:
            raise forbidden_scope({"reason": "wrong_hospital"})

    return step


def require_national_role(*roles: str) -> Step:
    if not roles:
        raise ValueError("require_national_role needs at least one role.")

    def step(req: ApiRequest) -> None:
        principal = req.principal
        if principal is None:
            raise auth_required()
        if principal.kind != "national":
            raise forbidden_scope({"needed": list(roles), "was": principal.kind})
        if not any(role in principal.roles for role in roles):
            raise forbidden_scope({"needed": list(roles)})

    return step


def has_role(principal: Principal | None, role: str) -> bool:
    return principal is not None and principal.kind == "staff" and role in principal.roles


def require_owner() -> Step:
    def step(req: ApiRequest) -> None:
        principal = req.principal
        if principal is None:
            raise auth_required()
        if principal.kind == "staff":
            raise forbidden_scope({"reason": "staff_must_use_console_routes"})

    return step


def require_booking_scope(param: str = "bookingId") -> Step:
    """A tracking link acts on the one booking it names and no other (`FR-GST-05`)."""

    def step(req: ApiRequest) -> None:
        principal = req.principal
        if principal is None:
            raise auth_required()
        if principal.kind != "guest":
            return
        target = req.params.get(param) if isinstance(req.params, dict) else None
        if not isinstance(target, str) or target == "":
            raise forbidden_scope({"reason": "missing_booking_parameter", "param": param})
        if principal.booking_id is None:
            raise forbidden_scope({"reason": "guest_token_not_scoped_to_a_booking"})
        if principal.booking_id != target:
            raise forbidden_scope({"reason": "link_is_for_a_different_booking"})

    return step


# --- Idempotency-Key (FR-PAY-06, FR-QUE-51) ---------------------------------

UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_KEY = re.compile(r"^[A-Za-z0-9_-]+$")


def idempotency(required: bool = False) -> Step:
    """Validates and attaches `Idempotency-Key` on unsafe methods.

    The durable record belongs with the resource (`queue_events.client_event_id`,
    `payments.idempotency_key`, both unique), not with this step.
    """

    def step(req: ApiRequest) -> None:
        if req.method not in UNSAFE_METHODS:
            return
        key = req.get("idempotency-key")
        if key is None or key == "":
            if required:
                raise AppError(
                    "IDEMPOTENCY_KEY_REQUIRED",
                    details={"header": "Idempotency-Key", "method": req.method},
                )
            return
        if len(key) < 16 or len(key) > 128 or _KEY.fullmatch(key) is None:
            raise AppError(
                "VALIDATION_FAILED",
                message="Idempotency-Key must be 16-128 characters of [A-Za-z0-9_-].",
                details={"header": "Idempotency-Key"},
            )
        req.idempotency_key = key

    return step


def is_unsafe_method(method: str) -> bool:
    return method.upper() in UNSAFE_METHODS


#: The per-route step for writes where a duplicate costs a place or money.
WRITE = idempotency(required=True)
