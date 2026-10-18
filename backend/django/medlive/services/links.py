"""The links a message carries (ports of `trackingLink.ts`, `standbyLink.ts`,
`bedRequestLink.ts`, `emergencyLink.ts` and `messageLink.service.ts`).

A tracking link is an opaque token whose hash is stored (`guest_links`); the
others are signed tokens with their own audience. A message keeps no
credential: when the outbox has to send a message again after a restart, the
link is issued afresh from the parameters kept with it (`reissue_link`).
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from typing import Any, Mapping
from urllib.parse import urlsplit

from ..core.errors import not_found
from ..core.jwt import sign_token
from ..core.links import patient_link
from ..repositories import booking as booking_repo
from ..repositories import guest as guest_repo
from ..repositories import session as session_repo

GRACE = timedelta(hours=24)

LINK_KINDS = ("booking", "standby", "bed_request", "emergency_case", "records")
LINK_PARAMS = {"kind": "linkKind", "base": "linkBase", "subject": "linkSubject", "standbyId": "standbyId"}


def mint_tracking_token(*, booking_id: str, session_id: str, phone: str) -> dict[str, str]:
    """A fresh tracking token for one booking, valid until the chamber ends plus a day."""
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf8")).hexdigest()
    guest_id = guest_repo.identity_id_for_phone(phone)
    if guest_id is None:
        raise not_found("guest identity")
    session = session_repo.find_by_id(session_id)
    if session is None:
        raise not_found("session")
    guest_repo.insert_tracking_link(
        booking_id=booking_id, guest_id=guest_id, token_hash=token_hash, expires_at=session["plannedEnd"] + GRACE
    )
    return {"token": token, "hospitalId": session["hospitalId"]}


def standby_token(standby_id: str, subject: str) -> str:
    return sign_token("standby", {"sub": subject, "kind": "guest", "standbyId": standby_id})


def standby_url(token: str, hospital_origin: str | None = None) -> str:
    return patient_link("/standby", {"t": token}, hospital_origin=hospital_origin)


def standby_link_for(standby_id: str, subject: str) -> str:
    return standby_url(standby_token(standby_id, subject))


def bed_request_token(request_id: str, subject: str) -> str:
    return sign_token("bed_request", {"sub": subject, "kind": "guest", "bedRequestId": request_id})


def bed_request_url(token: str, hospital_origin: str | None = None) -> str:
    return patient_link("/beds/request", {"t": token}, hospital_origin=hospital_origin)


def emergency_case_token(case_id: str) -> str:
    return sign_token("emergency_case", {"sub": case_id, "kind": "guest", "emergencyCaseId": case_id})


def emergency_case_url(token: str, hospital_origin: str | None = None) -> str:
    return patient_link("/emergency/onway", {"t": token}, hospital_origin=hospital_origin)


def origin_of(link: str) -> str | None:
    try:
        parts = urlsplit(link)
    except ValueError:
        return None
    if not parts.scheme or not parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}"


def _text(params: Mapping[str, Any], key: str) -> str | None:
    value = params.get(key)
    return value if isinstance(value, str) and value != "" else None


def reissue_link(params: Mapping[str, Any], phone: str | None) -> str | None:
    """A new link for a kept message, or None when one cannot honestly be made."""
    from . import portal

    kind = _text(params, LINK_PARAMS["kind"]) or ""
    base = _text(params, LINK_PARAMS["base"])
    if kind == "booking":
        booking_id = _text(params, "bookingId")
        if booking_id is None or phone is None:
            return None
        booking = booking_repo.find_by_id(booking_id)
        if booking is None:
            return None
        try:
            minted = mint_tracking_token(booking_id=booking_id, session_id=booking["sessionId"], phone=phone)
        except Exception:  # noqa: BLE001
            return None
        return patient_link(
            "/s",
            {"b": booking_id, "t": minted["token"]},
            hospital_origin=base or portal.hospital_link_origin(minted["hospitalId"]),
        )
    if kind == "standby":
        standby_id = _text(params, LINK_PARAMS["standbyId"])
        subject = _text(params, LINK_PARAMS["subject"])
        if standby_id is None or subject is None:
            return None
        return standby_url(standby_token(standby_id, subject), base)
    if kind == "bed_request":
        request_id = _text(params, "bedRequestId")
        subject = _text(params, LINK_PARAMS["subject"])
        if request_id is None or subject is None:
            return None
        return bed_request_url(bed_request_token(request_id, subject), base)
    if kind == "emergency_case":
        case_id = _text(params, "emergencyCaseId")
        if case_id is None:
            return None
        return emergency_case_url(emergency_case_token(case_id), base)
    if kind == "records":
        return patient_link("/records", {}, hospital_origin=base)
    return None
