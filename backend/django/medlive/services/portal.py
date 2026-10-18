"""A hospital's own address (port of `services/portal.service.ts`, `FR-BRD-07`)."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

from ..core.env import env, is_production
from ..core.links import allowed_origins
from ..core.scope import SYSTEM, db_scope
from ..domain.portal import portal_host_for, portal_host_of
from ..repositories import discovery as discovery_repo

REMEMBER_SECONDS = 30.0


@dataclass(frozen=True)
class _Recorded:
    by_host: dict[str, dict[str, str]]
    by_hospital: dict[str, str]
    read_at: float


_NOTHING = _Recorded({}, {}, 0.0)
_recorded = _NOTHING
_lock = threading.Lock()


def _read() -> _Recorded:
    with db_scope(SYSTEM):
        rows = discovery_repo.portal_domains()
    by_host = {r["domain"]: {"code": r["code"], "hospitalId": r["hospitalId"]} for r in rows}
    by_hospital = {r["hospitalId"]: r["domain"] for r in rows}
    return _Recorded(by_host, by_hospital, time.monotonic())


def _fresh(recorded: _Recorded) -> bool:
    return recorded.read_at != 0.0 and time.monotonic() - recorded.read_at < REMEMBER_SECONDS


def _recorded_domains() -> _Recorded:
    global _recorded
    if _fresh(_recorded):
        return _recorded
    with _lock:
        if not _fresh(_recorded):
            _recorded = _read()
        return _recorded


def forget_recorded_domains() -> None:
    global _recorded
    _recorded = _NOTHING


def platform_domain() -> str | None:
    return env().PLATFORM_DOMAIN or None


@dataclass(frozen=True)
class Address:
    #: "network" | "portal" | "nobodys"
    kind: str
    code: str | None = None


def scope_code_of_host(host: str) -> str | None:
    address = address_of(host)
    return address.code if address.kind == "portal" else None


def address_of(host: str) -> Address:
    which = portal_host_of(host, platform_domain())
    if which.kind == "network":
        return Address("network")
    if which.kind == "code":
        return Address("portal", which.code)
    e = env()
    for origin in (e.WEB_BASE_URL, *e.EXTRA_ALLOWED_ORIGINS):
        try:
            if urlsplit(origin).hostname == which.host:
                return Address("network")
        except ValueError:
            continue
    recorded = _recorded_domains().by_host.get(which.host or "")
    return Address("nobodys") if recorded is None else Address("portal", recorded["code"])


def _origin_parts(origin: str) -> tuple[str, str, int | None] | None:
    """`(scheme, hostname, port)` when `origin` is exactly an origin, else None."""
    try:
        url = urlsplit(origin)
        port = url.port
    except ValueError:
        return None
    if url.scheme not in ("http", "https") or not url.hostname:
        return None
    default = 443 if url.scheme == "https" else 80
    shown_port = None if port in (None, default) else port
    rebuilt = f"{url.scheme}://{url.hostname}" + ("" if shown_port is None else f":{shown_port}")
    if rebuilt != origin:
        return None
    return url.scheme, url.hostname, shown_port


def _is_portal_origin(origin: str) -> bool:
    parts = _origin_parts(origin)
    if parts is None:
        return False
    scheme, hostname, port = parts
    if scheme != "https" and (is_production() or scheme != "http"):
        return False
    host = hostname if port is None else f"{hostname}:{port}"
    which = portal_host_of(host, platform_domain())
    if which.kind == "code":
        return True
    if which.kind == "foreign":
        return (which.host or "") in _recorded_domains().by_host
    return False


def origin_allowed(origin: str) -> bool:
    if origin in allowed_origins():
        return True
    return _is_portal_origin(origin)


def patient_origin_of(origin: str | None) -> str | None:
    e = env()
    if origin is None or origin == "" or origin == e.CONSOLE_BASE_URL:
        return None
    if origin == e.WEB_BASE_URL or origin in e.EXTRA_ALLOWED_ORIGINS:
        return origin
    return origin if _is_portal_origin(origin) else None


def hospital_link_origin(hospital_id: str) -> str | None:
    domain = _recorded_domains().by_hospital.get(hospital_id)
    return None if domain is None else f"https://{domain}"


def portal_addresses(code: str | None, own_domain: str | None) -> dict[str, str | None]:
    domain = platform_domain()
    web = urlsplit(env().WEB_BASE_URL)
    port = "" if web.port is None else f":{web.port}"
    return {
        "platform": None
        if code is None or domain is None
        else f"{web.scheme}:" + f"//{portal_host_for(code, domain)}{port}",
        "own": None if own_domain is None else f"https://{own_domain}",
    }
