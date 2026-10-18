"""Addresses put in front of a patient, and the browser origins answered
(port of `config/links.ts`, `FR-BRD-04`)."""

from __future__ import annotations

from typing import Mapping
from urllib.parse import quote, urlsplit, urlunsplit

from .env import env
from .request_origin import current_patient_origin


def _encode_query_component(value: str) -> str:
    """`URLSearchParams` encoding: application/x-www-form-urlencoded."""
    return quote(value, safe="*-._").replace("%20", "+")


def patient_link(
    path: str,
    query: Mapping[str, str] | None = None,
    *,
    hospital_origin: str | None = None,
) -> str:
    """A link into the patient app, at the address the patient is using.

    `new URL(path, base)` with `searchParams.set` for each query key.
    """
    base = current_patient_origin() or hospital_origin or env().WEB_BASE_URL
    base_parts = urlsplit(base)
    if path.startswith("/"):
        target_path = path
    else:
        directory = base_parts.path.rsplit("/", 1)[0] if "/" in base_parts.path else ""
        target_path = f"{directory}/{path}"
    path_part, _, existing_query = target_path.partition("?")
    pairs: list[tuple[str, str]] = []
    if existing_query:
        for item in existing_query.split("&"):
            key, _, value = item.partition("=")
            pairs.append((key, value))
    for key, value in (query or {}).items():
        encoded_key = _encode_query_component(key)
        pairs = [pair for pair in pairs if pair[0] != encoded_key]
        pairs.append((encoded_key, _encode_query_component(value)))
    query_text = "&".join(f"{k}={v}" for k, v in pairs)
    return urlunsplit(
        (base_parts.scheme, base_parts.netloc, path_part or "/", query_text, "")
    )


def allowed_origins() -> list[str]:
    """The patient app, the console, and any extra exact origins; never a wildcard."""
    e = env()
    seen: list[str] = []
    for origin in (e.WEB_BASE_URL, e.CONSOLE_BASE_URL, *e.EXTRA_ALLOWED_ORIGINS):
        if origin not in seen:
            seen.append(origin)
    return seen
