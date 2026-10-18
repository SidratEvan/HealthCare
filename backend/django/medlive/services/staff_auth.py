"""Staff sign-in (port of `services/staffAuth.service.ts`; S-B-00, FR-SEC-06, FR-ROLE-01, FR-SUP-01).

Email and password, then a second factor where the account has one (and an
administrator must). Five wrong tries lock the account. A refresh token is
single-use and belongs to a family: one presented twice revokes them all.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Any

from ..core import db
from ..core.env import env
from ..core.errors import AppError
from ..core.jwt import duration_ms, sign_token, verify_token
from ..core.logging import logger
from ..core.password import (
    burn_verification,
    hash_password,
    needs_rehash,
    password_problem,
    temporary_password,
    verify_password,
)
from ..core.principal import Principal
from ..core.totp import (
    RECOVERY_CODE_COUNT,
    match_step,
    new_recovery_codes,
    new_totp_secret,
    normalise_recovery_code,
    open_secret,
    otpauth_uri,
    recovery_hash,
    seal_secret,
)
from ..domain.enums import TWO_FACTOR_REQUIRED_ROLES
from ..domain.time import from_datetime, from_epoch_ms, now_ms, utc_now
from ..repositories import chamber as chamber_repo
from ..repositories import staff_auth as staff_auth_repo
from .access_guard import end_staff_session, revoke_staff_sessions
from .desk_access import desk_limit

CHALLENGE_TTL_MS = 5 * 60_000


def _invalid_credentials() -> AppError:
    return AppError("AUTH_INVALID_CREDENTIALS")


def _locked_until(until: datetime) -> AppError:
    return AppError("AUTH_LOCKED", details={"until": from_datetime(until)})


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf8")).hexdigest()


def _is_locked(account: dict[str, Any], now: datetime) -> bool:
    return account["lockedUntil"] is not None and account["lockedUntil"] > now


def requires_two_factor(roles: list[str] | tuple[str, ...]) -> bool:
    return any(role in TWO_FACTOR_REQUIRED_ROLES for role in roles)


def _two_factor_of(account: dict[str, Any], roles: list[str]) -> dict[str, Any]:
    return {
        "enabled": account["totpEnabled"],
        "required": requires_two_factor(roles),
        "recoveryCodesLeft": account["recoveryCodesLeft"] if account["totpEnabled"] else 0,
    }


def _user_agent(client: dict[str, str | None]) -> str | None:
    agent = client["userAgent"]
    return None if agent is None else agent[:300]


def _hospital_of(account: dict[str, Any]) -> dict[str, Any] | None:
    if account["hospitalId"] is None:
        return None
    return {
        "id": account["hospitalId"],
        "code": account["hospitalCode"],
        "nameBn": account["hospitalNameBn"] or "",
        "nameEn": account["hospitalNameEn"] or "",
    }


def _issue(
    account: dict[str, Any], roles: list[str], client: dict[str, str | None], family_id: str | None = None
) -> dict[str, Any]:
    family_id = family_id or str(uuid.uuid4())
    access_ttl = duration_ms(env().JWT_ACCESS_TTL)
    two_factor = _two_factor_of(account, roles)
    setup_only = two_factor["required"] and not two_factor["enabled"] and not account["mustChangePassword"]
    secret = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")
    session_id = staff_auth_repo.create_refresh_session(
        staff_id=account["id"],
        token_hash=_sha256(secret),
        expires_at=utc_now() + timedelta(milliseconds=duration_ms(env().JWT_REFRESH_TTL)),
        ip=client["ip"],
        user_agent=_user_agent(client),
        family_id=family_id,
    )
    claims: dict[str, Any] = {"sub": account["id"], "kind": "staff", "sid": family_id}
    if account["hospitalId"] is not None:
        claims["hospitalId"] = account["hospitalId"]
    claims["roles"] = roles
    if account["mustChangePassword"]:
        claims["mcp"] = True
    if setup_only:
        claims["tfa"] = "setup"
    access = sign_token("access", claims)
    return {
        "access": access,
        "accessExpiresAt": from_epoch_ms(now_ms() + access_ttl - 5_000),
        "refresh": f"{session_id}.{secret}",
        "staff": {"id": account["id"], "fullName": account["fullName"], "email": account["email"]},
        "hospital": _hospital_of(account),
        "roles": roles,
        "mustChangePassword": account["mustChangePassword"],
        "twoFactor": two_factor,
    }


def _roles_or_refuse(account: dict[str, Any]) -> list[str]:
    roles = staff_auth_repo.roles_of(account["id"], account["hospitalId"])
    if not roles:
        raise AppError("AUTH_FORBIDDEN_SCOPE", details={"reason": "no_roles"})
    return roles


def _fail(account: dict[str, Any]) -> AppError:
    until = staff_auth_repo.record_failure(account["id"], env().STAFF_LOCKOUT_ATTEMPTS, env().STAFF_LOCKOUT_MINUTES)
    return _locked_until(until) if until is not None and until > utc_now() else _invalid_credentials()


def login(*, email: str, password: str, hospital_code: str | None, client: dict[str, str | None]) -> dict[str, Any]:
    now = utc_now()
    accounts = staff_auth_repo.find_by_email(email, hospital_code)
    if not accounts:
        burn_verification(password)
        raise _invalid_credentials()
    open_accounts = [account for account in accounts if not _is_locked(account, now)]
    matches = [
        account for account in open_accounts if account["isActive"] and verify_password(password, account["passwordHash"])
    ]
    if len(matches) > 1:
        raise AppError("AUTH_HOSPITAL_REQUIRED")
    if not matches:
        if not open_accounts:
            soonest = sorted(a["lockedUntil"] for a in accounts if a["lockedUntil"] is not None)
            raise _locked_until(soonest[0] if soonest else now)
        outcomes = [_fail(candidate) for candidate in open_accounts]
        raise next((outcome for outcome in outcomes if outcome.code == "AUTH_LOCKED"), _invalid_credentials())
    account = matches[0]
    roles = _roles_or_refuse(account)
    if account["passwordHash"] is not None and needs_rehash(account["passwordHash"]):
        staff_auth_repo.upgrade_hash(account["id"], hash_password(password))
    if account["totpEnabled"]:
        challenge = sign_token("staff_2fa", {"sub": account["id"], "kind": "staff"})
        return {
            "requires2fa": True,
            "challenge": challenge,
            "challengeExpiresAt": from_epoch_ms(now_ms() + CHALLENGE_TTL_MS),
        }
    staff_auth_repo.record_success(account["id"])
    logger.info({"staffId": account["id"], "hospitalId": account["hospitalId"]}, "staff signed in")
    return {**_issue(account, roles, client), "requires2fa": False}


def _code_invalid() -> AppError:
    return AppError("AUTH_2FA_INVALID")


def _fail_code(account: dict[str, Any]) -> AppError:
    refused = _fail(account)
    return refused if refused.code == "AUTH_LOCKED" else _code_invalid()


_SIX_DIGITS = re.compile(r"^[0-9]{6}\Z")


def _spend_code(account: dict[str, Any], code: str) -> bool:
    if not account["totpEnabled"] or account["totpSecret"] is None:
        return False
    if _SIX_DIGITS.match(code):
        try:
            secret = open_secret(account["totpSecret"])
        except ValueError:
            logger.error({"staffId": account["id"]}, "TOTP secret does not open with this key")
            return False
        step = match_step(secret, code, now_ms(), account["totpLastStep"])
        return step is not None and staff_auth_repo.accept_totp_step(account["id"], step)
    recovery = normalise_recovery_code(code)
    if recovery is None:
        return False
    used = staff_auth_repo.use_recovery_code(account["id"], recovery_hash(recovery))
    if used:
        logger.warn({"staffId": account["id"]}, "staff signed in with a recovery code")
    return used


def _refresh_invalid(reason: str) -> AppError:
    return AppError("AUTH_TOKEN_INVALID", details={"reason": reason})


def verify_second_factor(*, challenge: str, code: str, client: dict[str, str | None]) -> dict[str, Any]:
    verified = verify_token(challenge, "staff_2fa")
    if not verified.ok:
        raise _refresh_invalid(f"challenge_{verified.reason}")  # type: ignore[union-attr]
    account = staff_auth_repo.find_by_id(verified.claims["sub"])  # type: ignore[union-attr]
    if account is None or account["isActive"] is not True:
        raise _refresh_invalid("account")
    if _is_locked(account, utc_now()) and account["lockedUntil"] is not None:
        raise _locked_until(account["lockedUntil"])
    if not account["totpEnabled"]:
        raise _refresh_invalid("challenge_stale")
    if not _spend_code(account, code.strip()):
        raise _fail_code(account)
    roles = _roles_or_refuse(account)
    staff_auth_repo.record_success(account["id"])
    logger.info({"staffId": account["id"], "hospitalId": account["hospitalId"]}, "staff signed in")
    return _issue(_account_of(account["id"]), roles, client)


def start_two_factor_setup(staff_id: str) -> dict[str, str]:
    account = _account_of(staff_id)
    if account["totpEnabled"]:
        raise AppError("AUTH_2FA_ALREADY_ON")
    sealed = staff_auth_repo.pending_totp(account["id"], seal_secret(new_totp_secret()))
    if sealed is None:
        raise AppError("AUTH_2FA_ALREADY_ON")
    try:
        secret = open_secret(sealed)
    except ValueError:
        sealed = staff_auth_repo.pending_totp(account["id"], seal_secret(new_totp_secret()), True)
        if sealed is None:
            raise AppError("AUTH_2FA_ALREADY_ON") from None
        secret = open_secret(sealed)
    return {
        "secret": secret,
        "otpauthUri": otpauth_uri(
            secret=secret, account=account["email"], issuer=account["hospitalNameEn"] or "MedLiveBD"
        ),
    }


def enable_two_factor(staff_id: str, code: str, client: dict[str, str | None]) -> dict[str, Any]:
    account = _account_of(staff_id)
    if account["totpEnabled"]:
        raise AppError("AUTH_2FA_ALREADY_ON")
    if account["totpSecret"] is None:
        raise _code_invalid()
    try:
        secret = open_secret(account["totpSecret"])
    except ValueError:
        raise _code_invalid() from None
    step = match_step(secret, code, now_ms(), None)
    if step is None:
        raise _code_invalid()
    recovery_codes = new_recovery_codes(RECOVERY_CODE_COUNT)
    with db.transaction():
        enabled = staff_auth_repo.enable_totp(
            staff_id=account["id"], step=step, recovery_hashes=[recovery_hash(c) for c in recovery_codes]
        )
        if enabled:
            staff_auth_repo.record_security_change(
                actor_staff_id=account["id"],
                hospital_id=account["hospitalId"],
                staff_id=account["id"],
                change="two_factor_enabled",
                ip=client["ip"],
                user_agent=_user_agent(client),
            )
    if not enabled:
        raise AppError("AUTH_2FA_ALREADY_ON")
    revoke_staff_sessions(account["id"])
    updated = _account_of(account["id"])
    return {"recoveryCodes": recovery_codes, "session": _issue(updated, _roles_or_refuse(updated), client)}


def reset_two_factor_from_server(*, email: str, hospital_code: str | None) -> dict[str, Any] | None:
    accounts = staff_auth_repo.find_by_email(email, hospital_code)
    if len(accounts) > 1:
        raise RuntimeError(f"{email} has accounts at more than one facility; give --hospital-code.")
    if not accounts:
        return None
    account = accounts[0]
    with db.transaction():
        staff_auth_repo.clear_two_factor(account["id"])
        staff_auth_repo.record_security_change(
            actor_staff_id=None,
            hospital_id=account["hospitalId"],
            staff_id=account["id"],
            change="two_factor_reset_from_server",
            ip=None,
            user_agent=None,
        )
    revoke_staff_sessions(account["id"])
    return {"fullName": account["fullName"], "hospitalCode": account["hospitalCode"]}


_SESSION_ID = re.compile(r"^[0-9a-f-]{36}\Z", re.IGNORECASE)


def _parse_refresh(token: str) -> dict[str, str] | None:
    dot = token.find(".")
    if dot <= 0:
        return None
    session_id, secret = token[:dot], token[dot + 1 :]
    if not _SESSION_ID.match(session_id) or len(secret) < 20:
        return None
    return {"id": session_id, "secret": secret}


def _hash_matches(secret: str, stored: str) -> bool:
    try:
        candidate, expected = bytes.fromhex(_sha256(secret)), bytes.fromhex(stored)
    except ValueError:
        return False
    return len(candidate) == len(expected) and hmac.compare_digest(candidate, expected)


def refresh(token: str, client: dict[str, str | None]) -> dict[str, Any]:
    parsed = _parse_refresh(token)
    if parsed is None:
        raise _refresh_invalid("malformed")
    session = staff_auth_repo.find_refresh_session(parsed["id"])
    if session is None or not _hash_matches(parsed["secret"], session["tokenHash"]):
        raise _refresh_invalid("unknown")
    if session["revokedAt"] is not None:
        revoke_staff_sessions(session["subjectId"])
        logger.warn({"staffId": session["subjectId"]}, "refresh token reused; sessions revoked")
        raise _refresh_invalid("reused")
    if session["expiresAt"] <= utc_now():
        raise _refresh_invalid("expired")
    account = staff_auth_repo.find_by_id(session["subjectId"])
    if account is None or account["isActive"] is not True:
        raise _refresh_invalid("account")
    with db.transaction():
        if not staff_auth_repo.revoke_refresh_session(session["id"]):
            raise _refresh_invalid("raced")
        return _issue(account, _roles_or_refuse(account), client, session["familyId"])


def logout(token: str) -> None:
    parsed = _parse_refresh(token)
    if parsed is None:
        return
    session = staff_auth_repo.find_refresh_session(parsed["id"])
    if session is not None and _hash_matches(parsed["secret"], session["tokenHash"]):
        end_staff_session(session)


def _account_of(staff_id: str) -> dict[str, Any]:
    account = staff_auth_repo.find_by_id(staff_id)
    if account is None or account["isActive"] is not True:
        raise AppError("AUTH_REQUIRED")
    return account


def me(staff_id: str) -> dict[str, Any]:
    account = _account_of(staff_id)
    roles = staff_auth_repo.roles_of(account["id"], account["hospitalId"])
    return {
        "staff": {"id": account["id"], "fullName": account["fullName"], "email": account["email"]},
        "hospital": _hospital_of(account),
        "roles": roles,
        "mustChangePassword": account["mustChangePassword"],
        "twoFactor": _two_factor_of(account, roles),
    }


def change_password(staff_id: str, *, current: str, next_password: str, client: dict[str, str | None]) -> dict[str, Any]:
    account = _account_of(staff_id)
    if _is_locked(account, utc_now()) and account["lockedUntil"] is not None:
        raise _locked_until(account["lockedUntil"])
    if not verify_password(current, account["passwordHash"]):
        raise _fail(account)
    problem = password_problem(next_password, current)
    if problem is not None:
        raise AppError("AUTH_PASSWORD_WEAK", details={"reason": problem})
    staff_auth_repo.set_password(account["id"], hash_password(next_password), False)
    revoke_staff_sessions(account["id"])
    updated = _account_of(account["id"])
    return _issue(updated, _roles_or_refuse(updated), client)


def chambers(hospital_id: str) -> list[dict[str, Any]]:
    return chamber_repo.todays_chambers(hospital_id)


def chambers_for(principal: Principal, include_ended: bool = False) -> list[dict[str, Any]]:
    every = chamber_repo.todays_chambers(principal.hospital_id, include_ended)
    allowed = desk_limit(principal)
    return every if allowed is None else [chamber for chamber in every if chamber["doctorId"] in allowed]


def create_platform_administrator(*, email: str, full_name: str) -> dict[str, str]:
    if staff_auth_repo.national_email_taken(email):
        raise RuntimeError(f"{email} already has a platform account.")
    password = temporary_password()
    password_hash = hash_password(password)
    with db.transaction():
        staff_id = staff_auth_repo.create_staff_account(
            hospital_id=None, email=email, full_name=full_name, staff_code=None, password_hash=password_hash, created_by=None
        )
        staff_auth_repo.grant_role(staff_id=staff_id, hospital_id=None, role="platform_admin")
    return {"staffId": staff_id, "temporaryPassword": password}


def create_first_administrator(
    *, hospital_code: str, email: str, full_name: str, hospital: dict[str, str] | None = None
) -> dict[str, Any]:
    code = hospital_code.upper()
    existing = staff_auth_repo.hospital_id_by_code(code)
    if existing is None and hospital is None:
        raise RuntimeError(
            f"No facility has the code {code}; give its names, kind, division and district to create it."
        )
    if existing is not None and staff_auth_repo.email_taken_at(existing, email):
        raise RuntimeError(f"{email} already has an account at {code}.")
    password = temporary_password()
    password_hash = hash_password(password)
    with db.transaction():
        hospital_id = existing
        if hospital_id is None:
            assert hospital is not None  # checked above
            hospital_id = staff_auth_repo.create_hospital(
                code=code,
                name_bn=hospital["nameBn"],
                name_en=hospital["nameEn"],
                kind=hospital["kind"],
                division=hospital["division"],
                district=hospital["district"],
            )
        staff_id = staff_auth_repo.create_staff_account(
            hospital_id=hospital_id,
            email=email,
            full_name=full_name,
            staff_code=None,
            password_hash=password_hash,
            created_by=None,
        )
        staff_auth_repo.grant_role(staff_id=staff_id, hospital_id=hospital_id, role="hospital_admin")
    return {"hospitalId": hospital_id, "staffId": staff_id, "temporaryPassword": password, "createdHospital": existing is None}
