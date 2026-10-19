"""The request a route sees, and the replies it gives (Express's `req` / `res`).

`ApiRequest` carries what the Node middleware attached to `req`: the
principal, the request id, the idempotency key, and the validated params,
query and body. A controller returns a `Reply`; the pipeline turns it into the
HTTP response, adding the headers every answer carries.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Iterable, Mapping
from uuid import UUID

from .principal import Principal


def iso(value: datetime) -> str:
    """A JavaScript `Date.toISOString()`: UTC, milliseconds, `Z`."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def now_iso() -> str:
    from ..domain.time import utc_now

    return iso(utc_now())


class _Encoder(json.JSONEncoder):
    def default(self, o: Any) -> Any:
        if isinstance(o, datetime):
            return iso(o)
        if isinstance(o, date):
            return o.isoformat()
        if isinstance(o, (UUID, Decimal)):
            return str(o)
        if isinstance(o, (set, frozenset, tuple)):
            return list(o)
        to_json = getattr(o, "to_json", None)
        if callable(to_json):
            return to_json()
        return super().default(o)


def _js_numbers(value: Any) -> Any:
    """JavaScript has one number type: an integral float is written `3`, not `3.0`."""
    if isinstance(value, float):
        if value.is_integer() and abs(value) < 1e21:
            return int(value)
        return value
    if isinstance(value, dict):
        return {key: _js_numbers(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_js_numbers(item) for item in value]
    return value


def dumps(value: Any) -> str:
    """`JSON.stringify` with Express's `json spaces: 0`: compact, UTF-8, no escaping."""
    return json.dumps(_js_numbers(value), cls=_Encoder, ensure_ascii=False, separators=(",", ":"))


class Headers:
    """Case-insensitive request headers."""

    def __init__(self, raw: Mapping[str, str]) -> None:
        self._raw = {key.lower(): value for key, value in raw.items()}

    def get(self, name: str) -> str | None:
        return self._raw.get(name.lower())

    def items(self) -> Iterable[tuple[str, str]]:
        return self._raw.items()


@dataclass
class ApiRequest:
    method: str
    #: The whole path, `/api/v1/...` (Express's `req.originalUrl` without the query).
    path: str
    headers: Headers
    ip: str
    secure: bool
    query_raw: dict[str, Any]
    body_bytes: bytes
    content_type: str | None
    request_id: str = ""
    principal: Principal | None = None
    idempotency_key: str | None = None
    #: Parsed JSON body (`req.body`), or None when nothing was parsed.
    body: Any = None
    #: After `validate`: the parsed models; before, the raw values.
    params: Any = field(default_factory=dict)
    query: Any = None
    #: The bytes a webhook was signed over (`config/rawBody.ts`).
    raw_body: str | None = None
    #: The route pattern that matched, for the request log.
    route: str | None = None
    #: Headers a step wants on the answer (rate-limit counters, for instance).
    response_headers: dict[str, str] = field(default_factory=dict)
    #: The underlying Django request, for the few routes that need it.
    django: Any = None
    #: A route's own body limit, when its parser runs after its first steps.
    deferred_body_limit: int | None = None

    def __post_init__(self) -> None:
        if self.query is None:
            self.query = dict(self.query_raw)

    def get(self, name: str) -> str | None:
        return self.headers.get(name)

    @property
    def api_path(self) -> str:
        """The path within the API's mount, as a router sees `req.path`."""
        prefix = "/api/v1"
        if self.path.lower().startswith(prefix):
            rest = self.path[len(prefix) :]
            return rest if rest.startswith("/") else "/" + rest
        return self.path


@dataclass
class Reply:
    """What a controller answers with."""

    status: int = 200
    body: Any = None
    #: Already-encoded bytes (a file, a page); `body` is ignored when set.
    raw: bytes | None = None
    content_type: str = "application/json; charset=utf-8"
    headers: dict[str, str] = field(default_factory=dict)


def ok(data: Any, status: int = 200, headers: Mapping[str, str] | None = None) -> Reply:
    """`res.status(status).json({ ok: true, data })`."""
    return Reply(status=status, body={"ok": True, "data": data}, headers=dict(headers or {}))


def json_reply(body: Any, status: int = 200, headers: Mapping[str, str] | None = None) -> Reply:
    return Reply(status=status, body=body, headers=dict(headers or {}))


def no_content() -> Reply:
    return Reply(status=204, raw=b"", content_type="")


def raw_reply(
    data: bytes,
    content_type: str,
    status: int = 200,
    headers: Mapping[str, str] | None = None,
) -> Reply:
    return Reply(status=status, raw=data, content_type=content_type, headers=dict(headers or {}))
