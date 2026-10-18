"""Token signing and verification (port of `config/jwt.ts`).

HS256, issuer `healthcare-api`, one secret and one signed audience per kind.
Tokens are interchangeable with the Node API's in both directions: a token the
Node API minted verifies here and the other way round, which is what lets the
two run side by side during the migration (`architecture.md` §Cut-over).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Literal

import jwt as pyjwt

from ..domain.schemas.clinical import CONSENT_OFFER_TTL_SECONDS
from .env import env

TokenKind = Literal[
    "access",
    "refresh",
    "guest",
    "consent",
    "bed_request",
    "emergency_case",
    "standby",
    "staff_2fa",
    "guest_device",
]

ISSUER = "healthcare-api"

AUDIENCES: dict[str, str] = {
    "access": "access",
    "refresh": "refresh",
    "guest": "guest-link",
    "consent": "consent-offer",
    "bed_request": "bed-request",
    "emergency_case": "emergency-case",
    "standby": "standby",
    "staff_2fa": "staff-2fa",
    "guest_device": "guest-device",
}


def _secret(kind: str) -> bytes:
    e = env()
    if kind in ("access", "staff_2fa"):
        return e.JWT_ACCESS_SECRET.encode("utf8")
    if kind == "refresh":
        return e.JWT_REFRESH_SECRET.encode("utf8")
    # guest, consent, bed_request, emergency_case, standby, guest_device:
    # the guest-link secret, kept apart by the signed audience.
    return e.GUEST_LINK_SECRET.encode("utf8")


_DURATION = re.compile(r"^([0-9]+)([smhd])$")
_UNIT_SECONDS = {"s": 1, "m": 60, "h": 3_600, "d": 86_400}


def duration_seconds(value: str) -> int:
    match = _DURATION.fullmatch(value)
    if match is None:
        raise ValueError(f"Not a duration: {value}")
    return int(match.group(1)) * _UNIT_SECONDS[match.group(2)]


def duration_ms(value: str) -> int:
    """A TTL in the form the env accepts (`15m`, `24h`, `30d`), in milliseconds."""
    return duration_seconds(value) * 1000


def _default_lifetime(kind: str) -> str:
    e = env()
    if kind == "access":
        return e.JWT_ACCESS_TTL
    if kind == "refresh":
        return e.JWT_REFRESH_TTL
    if kind in ("guest", "bed_request", "standby"):
        return f"{e.GUEST_LINK_TTL_DAYS}d"
    if kind == "consent":
        return f"{CONSENT_OFFER_TTL_SECONDS}s"
    if kind == "emergency_case":
        return "24h"
    if kind == "staff_2fa":
        return "5m"
    if kind == "guest_device":
        return "90d"
    raise ValueError(kind)


def _now_seconds() -> int:
    # The clock the rest of the API reads, so a test that moves it moves token
    # lifetimes too, as jose's `Date.now()` does under faked timers.
    from ..domain.time import now_ms

    return math.floor(now_ms() / 1000)


def sign_token(kind: str, claims: dict[str, Any], expires_in: str | None = None) -> str:
    now = _now_seconds()
    payload = {
        **claims,
        "iss": ISSUER,
        "aud": AUDIENCES[kind],
        "iat": now,
        "exp": now + duration_seconds(expires_in or _default_lifetime(kind)),
    }
    return pyjwt.encode(payload, _secret(kind), algorithm="HS256", headers={"typ": "JWT"})


@dataclass(frozen=True)
class Verified:
    ok: Literal[True]
    claims: dict[str, Any]


@dataclass(frozen=True)
class Refused:
    ok: Literal[False]
    #: "expired" | "malformed" | "wrong_audience" | "invalid"
    reason: str


def verify_token(token: str, kind: str) -> Verified | Refused:
    """Verifies against exactly one secret and audience; a reason, never an exception."""
    try:
        payload = pyjwt.decode(
            token,
            _secret(kind),
            algorithms=["HS256"],
            audience=AUDIENCES[kind],
            issuer=ISSUER,
            options={"require": [], "verify_iat": False, "verify_exp": False, "verify_nbf": False},
        )
    except pyjwt.ExpiredSignatureError:
        return Refused(False, "expired")
    except (pyjwt.InvalidAudienceError, pyjwt.InvalidIssuerError, pyjwt.MissingRequiredClaimError):
        return Refused(False, "wrong_audience")
    except pyjwt.InvalidSignatureError:
        return Refused(False, "invalid")
    except pyjwt.DecodeError:
        return Refused(False, "malformed")
    except pyjwt.InvalidTokenError:
        return Refused(False, "invalid")
    if not isinstance(payload, dict):
        return Refused(False, "malformed")
    # jose's claim checks, against the API's clock (`exp <= now` is expired).
    now = _now_seconds()
    exp = payload.get("exp")
    if exp is not None:
        if not isinstance(exp, (int, float)) or isinstance(exp, bool):
            return Refused(False, "wrong_audience")  # jose: ERR_JWT_CLAIM_VALIDATION_FAILED
        if exp <= now:
            return Refused(False, "expired")
    nbf = payload.get("nbf")
    if nbf is not None:
        if not isinstance(nbf, (int, float)) or isinstance(nbf, bool) or nbf > now:
            return Refused(False, "wrong_audience")  # jose: ERR_JWT_CLAIM_VALIDATION_FAILED
    sub = payload.get("sub")
    kind_claim = payload.get("kind")
    if not isinstance(sub, str) or kind_claim not in ("patient", "guest", "staff"):
        return Refused(False, "malformed")
    return Verified(True, payload)
