"""A hospital's portal address (`FR-BRD-07`; port of `shared/domain/src/brand/portal.ts`)."""

from __future__ import annotations

import re
from dataclasses import dataclass

RESERVED_PORTAL_LABELS: tuple[str, ...] = (
    "www",
    "app",
    "api",
    "console",
    "admin",
    "staff",
    "status",
    "mail",
)

_CODE_LABEL = re.compile(r"^[a-z0-9][a-z0-9-]{1,15}$")
HOST_NAME = re.compile(
    r"^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$"
)
IPV4 = re.compile(r"^[0-9]{1,3}(\.[0-9]{1,3}){3}$")
_LOCALHOST_SUB = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.localhost$")
_PORT = re.compile(r"^[0-9]{1,5}$")


@dataclass(frozen=True)
class PortalHost:
    #: "network" | "code" | "foreign"
    kind: str
    code: str | None = None
    host: str | None = None


def normalise_host(value: str) -> str | None:
    host = value.strip().lower()
    if "[" in host or "]" in host:
        return None
    colon = host.rfind(":")
    if colon >= 0:
        if not _PORT.fullmatch(host[colon + 1 :]):
            return None
        host = host[:colon]
    if host.endswith("."):
        host = host[:-1]
    if host == "localhost":
        return host
    if IPV4.fullmatch(host):
        return host
    if _LOCALHOST_SUB.fullmatch(host):
        return host
    return host if HOST_NAME.fullmatch(host) else None


def portal_host_of(hostname: str, platform_domain: str | None) -> PortalHost:
    host = normalise_host(hostname)
    domain = None if platform_domain is None else normalise_host(platform_domain)
    if host is None or domain is None:
        return PortalHost("network")
    if host == domain:
        return PortalHost("network")
    if host.endswith(f".{domain}"):
        label = host[: -(len(domain) + 1)]
        if "." not in label and _CODE_LABEL.fullmatch(label) and label not in RESERVED_PORTAL_LABELS:
            return PortalHost("code", code=label.upper())
        return PortalHost("network")
    if host == "localhost" or IPV4.fullmatch(host) or host.endswith(".localhost"):
        return PortalHost("network")
    return PortalHost("foreign", host=host)


def portal_host_for(code: str, platform_domain: str) -> str:
    return f"{code.lower()}.{platform_domain.lower()}"
