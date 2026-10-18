"""Patients' phone verification, sessions and claiming (port of `services/patientAuth.service.ts`;
FR-PAT-01, FR-PAT-04, FR-GST-03, FR-GST-04, FR-GST-09, FR-GST-12, FR-SEC-05).

A code is six digits, stored only as an HMAC, five wrong tries lock the
phone for fifteen minutes, and a refresh token is single-use: one presented
twice revokes every session of that account.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
from datetime import timedelta
from typing import Any

from ..adapters.sms import sms
from ..core import db
from ..core.env import env
from ..core.errors import AppError, validation_failed
from ..core.jwt import duration_ms, sign_token, verify_token
from ..core.logging import logger
from ..core.principal import Principal
from ..core.scope import SYSTEM, db_scope
from ..domain.phone import normalise_bd_mobile
from ..domain.time import from_datetime, from_epoch_ms, js_round, now_ms, utc_now
from ..repositories import patient_auth as repo

MAX_CODE_ATTEMPTS = 5
CODE_LOCK_MINUTES = 15
RESEND_AFTER_SECONDS = 60


def client_of(ip: str | None, device: str | None) -> dict[str, str | None]:
    return {"ip": ip, "device": device}


def _phone_of(typed: str) -> str:
    phone = normalise_bd_mobile(typed)
    if phone is None:
        raise validation_failed({"field": "phone", "reason": "not_bd_mobile"})
    return phone


def _code_hash(phone: str, code: str) -> str:
    return hmac.new(env().JWT_REFRESH_SECRET.encode("utf8"), f"{phone}:{code}".encode("utf8"), hashlib.sha256).hexdigest()


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf8")).hexdigest()


def _same_hash(a: str, b: str) -> bool:
    try:
        left, right = bytes.fromhex(a), bytes.fromhex(b)
    except ValueError:
        return False
    return len(left) == len(right) and hmac.compare_digest(left, right)


def _device_of(client: dict[str, str | None]) -> str | None:
    device = client["device"]
    # String.prototype.slice counts UTF-16 units; a user agent is ASCII in practice.
    return None if device is None else device[:300]


def _random_secret() -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")


def request_code(typed_phone: str, client: dict[str, str | None]) -> dict[str, Any]:
    phone = _phone_of(typed_phone)
    locked = repo.locked_until(phone)
    if locked is not None:
        raise AppError("AUTH_LOCKED", details={"until": from_datetime(locked)})
    if repo.sent_in_last_hour(phone) >= env().OTP_MAX_PER_HOUR:
        raise AppError("AUTH_OTP_RATE_LIMIT", details={"perHour": env().OTP_MAX_PER_HOUR})
    code = str(secrets.randbelow(1_000_000)).rjust(6, "0")
    challenge_id = repo.create_challenge(
        phone=phone,
        code_hash=_code_hash(phone, code),
        expires_at=utc_now() + timedelta(seconds=env().OTP_TTL_SECONDS),
        ip=client["ip"],
    )
    minutes = js_round(env().OTP_TTL_SECONDS / 60)
    sent = sms().send(
        to=phone,
        body=f"{code} — MedLiveBD যাচাই কোড। {minutes} মিনিট পর্যন্ত কাজ করবে। কাউকে বলবেন না।",
        notification_id=challenge_id,
        template_key="auth.otp",
        sensitive=True,
    )
    if not sent.ok:
        logger.warn({"challengeId": challenge_id, "error": sent.error}, "sign-in code not sent")
    answer: dict[str, Any] = {"ttlSeconds": env().OTP_TTL_SECONDS, "resendAfterSeconds": RESEND_AFTER_SECONDS}
    if env().DEMO_MODE:
        answer["demoCode"] = code
    return answer


def verify(typed_phone: str, code: str, client: dict[str, str | None]) -> dict[str, Any]:
    phone = _phone_of(typed_phone)
    _check_code(phone, code)
    user = repo.sign_in_user(phone)
    return _issue({"id": user["id"], "phone": phone}, user["isNew"], client)


def _check_code(phone: str, code: str) -> None:
    locked = repo.locked_until(phone)
    if locked is not None:
        raise AppError("AUTH_LOCKED", details={"until": from_datetime(locked)})
    challenge = repo.open_challenge(phone)
    if challenge is None or challenge["expiresAt"].timestamp() * 1000 <= now_ms():
        raise AppError("AUTH_OTP_INVALID", details={"reason": "expired"})
    if not _same_hash(_code_hash(phone, code), challenge["codeHash"]):
        wrong = repo.record_wrong_code(challenge["id"], MAX_CODE_ATTEMPTS, CODE_LOCK_MINUTES)
        if wrong["lockedUntil"] is not None:
            raise AppError("AUTH_LOCKED", details={"until": from_datetime(wrong["lockedUntil"])})
        raise AppError("AUTH_OTP_INVALID", details={"reason": "wrong", "attemptsLeft": MAX_CODE_ATTEMPTS - wrong["attempts"]})
    if not repo.consume(challenge["id"]):
        raise AppError("AUTH_OTP_INVALID", details={"reason": "used"})


def _issue(user: dict[str, str], is_new: bool, client: dict[str, str | None]) -> dict[str, Any]:
    access_ttl = duration_ms(env().JWT_ACCESS_TTL)
    access = sign_token("access", {"sub": user["id"], "kind": "patient"})
    secret = _random_secret()
    session_id = repo.create_session(
        user_id=user["id"],
        token_hash=_sha256(secret),
        expires_at=utc_now() + timedelta(milliseconds=duration_ms(env().JWT_REFRESH_TTL)),
        ip=client["ip"],
        device=_device_of(client),
    )
    claimable = len(_claimable_of(user["phone"]))
    return {
        "access": access,
        "refresh": f"{session_id}.{secret}",
        "accessExpiresAt": from_epoch_ms(now_ms() + access_ttl),
        "user": user,
        "isNew": is_new,
        "claimable": claimable,
    }


def _refresh_invalid(reason: str) -> AppError:
    return AppError("AUTH_TOKEN_INVALID", details={"reason": reason})


_SESSION_ID = re.compile(r"^[0-9a-f-]{36}\Z", re.IGNORECASE)


def _parse_refresh(token: str) -> dict[str, str] | None:
    parts = token.split(".")
    if len(parts) != 2:
        return None
    session_id, secret = parts
    if not _SESSION_ID.match(session_id) or len(secret) < 20:
        return None
    return {"id": session_id, "secret": secret}


def refresh(token: str, client: dict[str, str | None]) -> dict[str, Any]:
    parsed = _parse_refresh(token)
    if parsed is None:
        raise _refresh_invalid("malformed")
    session = repo.find_session(parsed["id"])
    if session is None or not _same_hash(_sha256(parsed["secret"]), session["tokenHash"]):
        raise _refresh_invalid("unknown")
    if session["revokedAt"] is not None:
        repo.revoke_all_sessions(session["userId"])
        logger.warn({"userId": session["userId"]}, "patient refresh token reused; sessions revoked")
        raise _refresh_invalid("reused")
    if session["expiresAt"].timestamp() * 1000 <= now_ms():
        raise _refresh_invalid("expired")
    if session["device"] is not None and session["device"] != _device_of(client):
        repo.revoke_session(session["id"])
        raise _refresh_invalid("device")
    user = repo.user_by_id(session["userId"])
    if user is None:
        raise _refresh_invalid("account")
    if not repo.revoke_session(session["id"]):
        raise _refresh_invalid("raced")
    return _issue(user, False, client)


def logout(token: str) -> None:
    parsed = _parse_refresh(token)
    if parsed is None:
        return
    session = repo.find_session(parsed["id"])
    if session is None or not _same_hash(_sha256(parsed["secret"]), session["tokenHash"]):
        return
    repo.revoke_session(session["id"])


def profiles(user_id: str) -> list[dict[str, Any]]:
    return repo.profiles_of(user_id)


def _claimable_of(phone: str) -> list[dict[str, Any]]:
    with db_scope(SYSTEM):
        return repo.claimable_for(phone)


def claim(user_id: str, confirm: bool) -> dict[str, Any]:
    user = repo.user_by_id(user_id)
    if user is None:
        raise AppError("AUTH_TOKEN_INVALID", details={"reason": "account"})
    if not confirm:
        return {"claimable": _claimable_of(user["phone"]), "claimed": 0}
    with db_scope(SYSTEM), db.transaction():
        moved = repo.claim(user_id=user_id, phone=user["phone"])
        if moved > 0:
            repo.audit_claim(user_id=user_id, moved=moved)
    return {"claimable": [], "claimed": moved}


def guest_phone_check_required() -> bool:
    configured = env().GUEST_BOOKING_OTP
    return configured if configured is not None else not env().DEMO_MODE


def _guest_token_for(identity_id: str) -> str:
    return sign_token("access", {"sub": identity_id, "kind": "guest"})


def _device_mark(client: dict[str, str | None]) -> str:
    return _sha256(_device_of(client) or "")


def _device_proof_for(identity_id: str, client: dict[str, str | None]) -> str:
    return sign_token("guest_device", {"sub": identity_id, "kind": "guest", "dev": _device_mark(client)})


def _proves_device(proof: str, identity_id: str, client: dict[str, str | None]) -> bool:
    verified = verify_token(proof, "guest_device")
    return bool(
        verified.ok
        and verified.claims["sub"] == identity_id  # type: ignore[union-attr]
        and verified.claims.get("dev") == _device_mark(client)  # type: ignore[union-attr]
    )


def start_guest(typed_phone: str, name: str, client: dict[str, str | None], device_proof: str | None = None) -> dict[str, Any]:
    phone = _phone_of(typed_phone)
    if not guest_phone_check_required():
        return {"needsOtp": False, "guestToken": None}
    known = repo.verified_guest(phone)
    if known is not None and device_proof is not None and _proves_device(device_proof, known, client):
        return {
            "needsOtp": False,
            "guestToken": _guest_token_for(known),
            "deviceProof": _device_proof_for(known, client),
        }
    del name  # Kept for the record the verify step writes, not needed to send a code.
    return {"needsOtp": True, **request_code(phone, client)}


def verify_guest(typed_phone: str, code: str, name: str, client: dict[str, str | None]) -> dict[str, str]:
    phone = _phone_of(typed_phone)
    _check_code(phone, code)
    identity_id = repo.mark_guest_verified(phone, name)
    return {"guestToken": _guest_token_for(identity_id), "deviceProof": _device_proof_for(identity_id, client)}


def assert_guest_phone_proven(principal: Principal | None, typed_phone: str) -> None:
    if not guest_phone_check_required():
        return
    phone = _phone_of(typed_phone)
    identity = repo.verified_guest(phone)
    if principal is None or principal.kind != "guest" or identity is None or identity != principal.id:
        raise AppError("AUTH_REQUIRED", details={"reason": "phone_unverified"})
