"""The request pipeline (port of `app.ts`): the security model, in order.

  1. client address   `TRUST_PROXY_HOPS`, Express's `trust proxy`
  2. request id       every later log line and audit row uses it
  3. security headers on every answer, a refusal included
  4. CORS             by allowlist, before any body or token is read
  5. body parsing     bounded: 256 kB, or a route's own larger limit
  6. patient origin   where a link issued now should open (`FR-BRD-04`)
  7. principal        a bearer token, then a tracking link (`FR-GST-05`)
     ceiling          what is asked without an account, per address
  8. database scope   everything after runs as whoever is asking (`FR-SEC-11`)
  9. module gate      staff reach only the modules their hospital runs
 10. idempotency      a key, when given, is well formed
 11. routes           each applying its own guards
 12. not found        an unmatched path still gets the error envelope
 13. error handler    the single place anything becomes a response

Exposed to Django as a DRF `APIView` (`ApiView`) mounted at every path, so
DRF owns the HTTP plumbing and this module owns the order above.
"""

from __future__ import annotations

import base64
import hashlib
import json
import time
import uuid
from typing import Any, Callable

from django.http import HttpRequest, HttpResponse
from rest_framework.negotiation import BaseContentNegotiation
from rest_framework.renderers import BaseRenderer
from rest_framework.views import APIView

from ..domain.modules import modules_of_request
from .auth import attach_guest_from_link, attach_principal, idempotency
from .env import env
from .errors import AppError, BodyNotJson, PayloadTooLarge, as_app_error
from .http import ApiRequest, Headers, Reply, dumps
from .logging import request_logger
from .ratelimit import anonymous_ceiling
from .request_origin import with_patient_origin
from .router import Router
from .scope import db_scope, scope_of_principal

API_BASE_PATH = "/api/v1"
BODY_LIMIT = 256 * 1024

HSTS = "max-age=15552000; includeSubDomains"
CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
PERMISSIONS_POLICY = "geolocation=(), camera=(), microphone=(), payment=()"

ALLOWED_HEADERS = "authorization, content-type, idempotency-key"
ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
CONFIG_PATH = "/api/v1/config"

_global_idempotency = idempotency(required=False)

# Set by `medlive.routes` when the route table is built.
_api_router: Router | None = None
_root_router: Router | None = None


def install_routes(api: Router, root: Router) -> None:
    global _api_router, _root_router
    _api_router = api
    _root_router = root


def _routers() -> tuple[Router, Router]:
    if _api_router is None or _root_router is None:
        from ..routes import build  # noqa: F401  (builds and installs the table)

        build()
    assert _api_router is not None and _root_router is not None
    return _api_router, _root_router


# ---------------------------------------------------------------------------
# Building the request
# ---------------------------------------------------------------------------


def _raw_path(request: HttpRequest) -> str:
    scope = getattr(request, "scope", None)
    if isinstance(scope, dict) and scope.get("raw_path"):
        raw = scope["raw_path"]
        text = raw.decode("latin-1") if isinstance(raw, (bytes, bytearray)) else str(raw)
        return text.split("?", 1)[0] or "/"
    return request.path


def _client_ip(request: HttpRequest) -> str:
    """`req.ip` under `trust proxy = TRUST_PROXY_HOPS` (proxy-addr's walk)."""
    remote = request.META.get("REMOTE_ADDR") or ""
    hops = env().TRUST_PROXY_HOPS
    if hops == 0:
        return remote
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    addresses = [remote, *[a.strip() for a in reversed(forwarded.split(",")) if a.strip()]]
    return addresses[min(hops, len(addresses) - 1)]


def _secure(request: HttpRequest) -> bool:
    if env().TRUST_PROXY_HOPS > 0:
        proto = request.META.get("HTTP_X_FORWARDED_PROTO")
        if proto:
            return proto.split(",")[0].strip().lower() == "https"
    return request.scheme == "https"


def _query(request: HttpRequest) -> dict[str, Any]:
    """Express 5's simple query parser: a repeated key is a list."""
    out: dict[str, Any] = {}
    for key in request.GET.keys():
        values = request.GET.getlist(key)
        out[key] = values[0] if len(values) == 1 else values
    return out


def _headers(request: HttpRequest) -> Headers:
    raw: dict[str, str] = {}
    for key, value in request.META.items():
        if key.startswith("HTTP_"):
            raw[key[5:].replace("_", "-").lower()] = value
    if "CONTENT_TYPE" in request.META:
        raw["content-type"] = request.META["CONTENT_TYPE"]
    if "CONTENT_LENGTH" in request.META:
        raw["content-length"] = request.META["CONTENT_LENGTH"]
    return Headers(raw)


def _has_body(request: HttpRequest) -> bool:
    return bool(request.META.get("CONTENT_LENGTH")) or "HTTP_TRANSFER_ENCODING" in request.META


def _is_json(content_type: str | None) -> bool:
    if not content_type:
        return False
    return content_type.split(";", 1)[0].strip().lower() == "application/json"


def _reject_constant(value: str) -> Any:
    raise ValueError(f"not JSON: {value}")


def parse_json_body(data: bytes) -> Any:
    """body-parser's `json()` in strict mode."""
    if len(data) == 0:
        return {}
    text = data.decode("utf8")
    stripped = text.lstrip(" \t\n\r")
    if stripped == "" or stripped[0] not in "{[":
        raise BodyNotJson()
    try:
        return json.loads(text, parse_constant=_reject_constant)
    except ValueError as error:
        raise BodyNotJson() from error


# ---------------------------------------------------------------------------
# The steps
# ---------------------------------------------------------------------------


def _security_headers(req: ApiRequest, headers: dict[str, str]) -> None:
    headers["X-Content-Type-Options"] = "nosniff"
    headers["X-Frame-Options"] = "DENY"
    headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    headers["Referrer-Policy"] = "no-referrer"
    headers["Permissions-Policy"] = PERMISSIONS_POLICY
    headers["Cache-Control"] = "no-store"
    if req.secure:
        headers["Strict-Transport-Security"] = HSTS


def _cors(req: ApiRequest, headers: dict[str, str]) -> Reply | None:
    """Answers a preflight, or sets the allowing headers; None to go on."""
    from ..services.portal import origin_allowed

    origin = req.get("origin")
    if origin is None or origin == "":
        return None
    if origin_allowed(origin):
        headers["access-control-allow-origin"] = origin
        headers["access-control-allow-credentials"] = "true"
        headers["vary"] = "Origin"
        if req.method == "OPTIONS":
            headers["access-control-allow-methods"] = ALLOWED_METHODS
            headers["access-control-allow-headers"] = ALLOWED_HEADERS
            headers["access-control-max-age"] = "600"
            return Reply(status=204, raw=b"", content_type="")
        return None
    if req.path == CONFIG_PATH and req.method in ("GET", "OPTIONS"):
        headers["access-control-allow-origin"] = "*"
        if req.method == "GET":
            return None
        headers["access-control-allow-methods"] = "GET"
        headers["access-control-allow-headers"] = ALLOWED_HEADERS
        headers["access-control-max-age"] = "600"
        return Reply(status=204, raw=b"", content_type="")
    return None


def _parse_body(req: ApiRequest, request: HttpRequest, api: Router) -> None:
    if not _has_body(request) or not _is_json(req.content_type):
        return
    own_limit = api.body_limit_for(req.method, req.api_path) if req.path.lower().startswith(API_BASE_PATH) else None
    limit = own_limit if own_limit is not None else BODY_LIMIT
    declared = request.META.get("CONTENT_LENGTH")
    if declared and declared.isdigit() and int(declared) > limit:
        raise PayloadTooLarge()
    data = request.body
    if len(data) > limit:
        raise PayloadTooLarge()
    req.body_bytes = data
    if req.path.startswith("/api/v1/webhooks/"):
        req.raw_body = data.decode("utf8", errors="replace")
    req.body = parse_json_body(data)


def _module_gate(req: ApiRequest) -> None:
    principal = req.principal
    if principal is None or principal.kind != "staff" or not req.path.startswith(f"{API_BASE_PATH}/"):
        return
    needed = modules_of_request(req.method, req.path[len(API_BASE_PATH) :])
    if not needed:
        return
    from ..services.modules import first_off

    off = first_off(principal.hospital_id or "", needed)
    if off is not None:
        raise AppError("MODULE_OFF", details={"module": off})


def _dispatch(req: ApiRequest, api: Router, root: Router) -> Reply:
    in_api = req.path.lower().startswith(API_BASE_PATH) and (
        len(req.path) == len(API_BASE_PATH) or req.path[len(API_BASE_PATH)] == "/"
    )
    candidates: list[tuple[Router, str]] = [(root, req.path)]
    if in_api:
        candidates.append((api, req.api_path))
    for router, path in candidates:
        found = router.find(req.method, path)
        if found is None:
            continue
        route, params = found
        req.route = (API_BASE_PATH if router is api else "") + route.pattern
        req.params = params
        for step in route.steps:
            step(req)
        return route.handler(req)
    if req.method == "OPTIONS":
        allowed: list[str] = []
        for router, path in candidates:
            for route, _ in router.match_path(path):
                for method in ("GET", "HEAD") if route.method == "GET" else (route.method,):
                    if method not in allowed:
                        allowed.append(method)
        if allowed:
            text = ",".join(allowed)
            return Reply(
                status=200,
                raw=text.encode("utf8"),
                content_type="text/html; charset=utf-8",
                headers={"Allow": text},
            )
    raise AppError("NOT_FOUND", details={"method": req.method, "path": req.path})


# ---------------------------------------------------------------------------
# The whole of it
# ---------------------------------------------------------------------------


def _weak_etag(body: bytes) -> str:
    digest = base64.b64encode(hashlib.sha1(body).digest()).decode("ascii")[:27]
    return f'W/"{len(body):x}-{digest}"'


def _fresh(request: HttpRequest, etag: str) -> bool:
    if "HTTP_CACHE_CONTROL" in request.META and "no-cache" in request.META["HTTP_CACHE_CONTROL"]:
        return False
    match = request.META.get("HTTP_IF_NONE_MATCH")
    if not match:
        return False
    if match.strip() == "*":
        return True
    tags = [tag.strip() for tag in match.split(",")]
    plain = etag[2:] if etag.startswith("W/") else etag
    return any((tag[2:] if tag.startswith("W/") else tag) == plain for tag in tags)


def _to_response(request: HttpRequest, req: ApiRequest, reply: Reply, headers: dict[str, str]) -> HttpResponse:
    if reply.raw is not None:
        body = reply.raw
    elif reply.body is None and reply.status in (204, 304):
        body = b""
    else:
        body = dumps(reply.body).encode("utf8")
    status = reply.status
    merged = {**headers, **req.response_headers, **reply.headers}
    if body and request.method in ("GET", "HEAD") and "ETag" not in merged:
        etag = _weak_etag(body)
        merged["ETag"] = etag
        if 200 <= status < 300 and _fresh(request, etag):
            status = 304
            body = b""
    response = HttpResponse(
        b"" if request.method == "HEAD" else body,
        status=status,
        content_type=reply.content_type or None,
    )
    if not reply.content_type:
        del response["Content-Type"]
    for key, value in merged.items():
        response[key] = value
    if status not in (204, 304):
        response["Content-Length"] = str(len(body))
    return response


def handle(request: HttpRequest) -> HttpResponse:
    started = time.perf_counter()
    inbound_id = request.META.get("HTTP_X_REQUEST_ID")
    request_id = inbound_id if inbound_id and len(inbound_id) <= 64 else str(uuid.uuid4())
    req = ApiRequest(
        method=request.method or "GET",
        path=_raw_path(request),
        headers=_headers(request),
        ip=_client_ip(request),
        secure=_secure(request),
        query_raw=_query(request),
        body_bytes=b"",
        content_type=request.META.get("CONTENT_TYPE"),
        request_id=request_id,
        django=request,
    )
    headers: dict[str, str] = {"x-request-id": request_id}
    log = request_logger(request_id)
    try:
        api, root = _routers()
        _security_headers(req, headers)
        preflight = _cors(req, headers)
        if preflight is not None:
            reply = preflight
        else:
            _parse_body(req, request, api)
            from ..services.portal import patient_origin_of

            with with_patient_origin(patient_origin_of(req.get("origin"))):
                attach_principal(req)
                attach_guest_from_link(req)
                if req.path.lower().startswith(API_BASE_PATH):
                    anonymous_ceiling(req)
                with db_scope(scope_of_principal(req.principal)):
                    _module_gate(req)
                    _global_idempotency(req)
                    reply = _dispatch(req, api, root)
    except BaseException as thrown:  # noqa: BLE001 - the single place errors become answers
        if isinstance(thrown, (KeyboardInterrupt, SystemExit)):
            raise
        error = as_app_error(thrown)
        if isinstance(thrown, AppError):
            log.info(
                {"code": error.code, "status": error.status, "route": req.api_path, "method": req.method},
                "request refused",
            )
        else:
            log.error(
                {"code": error.code, "route": req.api_path, "method": req.method},
                "unhandled error",
                exc=thrown,
            )
        reply = Reply(status=error.status, body=error.to_body())
    response = _to_response(request, req, reply, headers)
    log.info(
        {
            "method": req.method,
            "route": req.route or req.path,
            "status": response.status_code,
            "durationMs": round((time.perf_counter() - started) * 1000),
            "principal": "anonymous" if req.principal is None else req.principal.kind,
            "principalId": None if req.principal is None else req.principal.id,
        },
        "request",
    )
    return response


# ---------------------------------------------------------------------------
# DRF: the view every path is routed to
# ---------------------------------------------------------------------------


class _PassThroughRenderer(BaseRenderer):
    media_type = "*/*"
    format = "raw"

    def render(self, data: Any, accepted_media_type: str | None = None, renderer_context: Any = None) -> Any:
        return data


class _AlwaysPassThrough(BaseContentNegotiation):
    """The pipeline renders its own answers; DRF never refuses an `Accept`."""

    def select_parser(self, request: Any, parsers: Any) -> Any:
        return None

    def select_renderer(self, request: Any, renderers: Any, format_suffix: Any = None) -> Any:
        return (renderers[0], renderers[0].media_type)


class ApiView(APIView):
    authentication_classes: list[Any] = []
    permission_classes: list[Any] = []
    throttle_classes: list[Any] = []
    renderer_classes = [_PassThroughRenderer]
    content_negotiation_class = _AlwaysPassThrough
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]

    @property
    def default_response_headers(self) -> dict[str, str]:
        # DRF would add `Allow` and `Vary: Accept`; the Node API sends neither.
        return {}

    def _handle(self, request: Any, *args: Any, **kwargs: Any) -> HttpResponse:
        return handle(request._request)

    get = post = put = patch = delete = head = options = _handle  # type: ignore[assignment]

    def handle_exception(self, exc: Exception) -> HttpResponse:
        # Only reachable for a failure inside DRF itself; the pipeline already
        # turned everything of ours into an envelope.
        error = as_app_error(exc)
        return HttpResponse(dumps(error.to_body()), status=error.status, content_type="application/json; charset=utf-8")


Handler = Callable[[ApiRequest], Reply]
