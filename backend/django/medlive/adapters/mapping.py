"""The mapping-suggestion adapter (port of `adapters/mapping.ts`; PRD.md §14b FR-IMP-16, FR-IMP-17).

The only AI in the product: a model suggests which of a file's columns is
which template field, for the columns the rules could not place. It is sent
headings and profiles only (`model_mapping_request`), never a value from a
row; its answer is read against a fixed shape and filtered to what was asked
(`with_model_suggestions`); a person confirms; the check decides.

`MAPPING_PROVIDER=off` is the default and a complete product. A provider
never raises into the request: every failure is a value. Raw HTTPS to the
Messages API through the standard library, as the Node API uses `fetch`
rather than an SDK.
"""

from __future__ import annotations

import json
import socket
import time
import urllib.error
import urllib.request
from typing import Any, Callable

from ..core.env import env
from ..core.logging import logger
from ..core.schema import z

_answer_shape = z.strict_object(
    {
        "suggestions": z.array(
            z.strict_object(
                {
                    "field": z.string().min(1).max(40),
                    "column": z.number().int().min(0).max(500),
                    "confidence": z.enum(["high", "medium", "low"]),
                    "reason": z.string().max(600),
                }
            )
        ).max(60)
    }
)

ANSWER_SCHEMA = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "field": {"type": "string"},
                    "column": {"type": "integer"},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                    "reason": {"type": "string"},
                },
                "required": ["field", "column", "confidence", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["suggestions"],
    "additionalProperties": False,
}

SYSTEM = "\n".join(
    [
        "You help a hospital administrator in Bangladesh match the columns of a spreadsheet export to the fields of an import template.",
        "You are given the template fields that still have no column, and the file columns that are still unused. For each column you are given only its heading, the kind of value it holds, how full it is, and a made-up example of that kind. You are never given a value from the file.",
        'Headings may be in English, Bangla, or abbreviated ("Pt. Cell", "Sx", "Yrs", "MR#").',
        "Suggest a column for a field only when the heading and the kind of value make it likely. Leave a field out when nothing fits: an honest gap is better than a guess, because a person reviews every suggestion and a wrong one costs them time.",
        "Use each column for at most one field and each field at most once. Only use the field names and column index numbers you were given.",
        "For each suggestion give a confidence (high, medium or low) and one short plain sentence saying why, which the administrator will read.",
        "Never suggest importing a national ID, an address, a photograph, a guardian or emergency contact, insurance, billing, or a password: the template has no field for them, and they are to be left out.",
    ]
)

#: Models documented to accept the `fallbacks: "default"` refusal fallback.
FALLBACK_MODELS = {"claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}


def _unavailable(reason: str) -> dict[str, Any]:
    return {"kind": "unavailable", "reason": reason}


class OffMappingProvider:
    name = "off"

    def propose(self, request: dict[str, Any]) -> dict[str, Any]:
        return _unavailable("off")


Transport = Callable[[urllib.request.Request, float], "tuple[int, bytes]"]


def _urlopen(request: urllib.request.Request, timeout: float) -> tuple[int, bytes]:
    """The standard library's HTTPS: an error status is an answer, not a raise."""
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, b""


class ClaudeMappingProvider:
    """Claude, over the Messages API. `transport` stands in for the network in a
    test, as `fetchImpl` does for the Node adapter."""

    name = "claude"

    def __init__(
        self, *, api_key: str, model: str, base_url: str, timeout_ms: int, transport: Transport | None = None
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url
        self.timeout_ms = timeout_ms
        self.transport = transport or _urlopen

    def propose(self, request: dict[str, Any]) -> dict[str, Any]:
        started = time.monotonic()
        answer = self._ask(request)
        # Counts and an outcome. No heading, no suggestion, no key.
        logger.info(
            {
                "provider": self.name,
                "model": self.model,
                "fieldsAsked": len(request["fields"]),
                "columnsOffered": len(request["columns"]),
                "outcome": "suggestions" if answer["kind"] == "suggestions" else answer["reason"],
                "suggestions": len(answer["suggestions"]) if answer["kind"] == "suggestions" else 0,
                "durationMs": round((time.monotonic() - started) * 1000),
            },
            "import mapping suggestions asked for",
        )
        return answer

    def _ask(self, request: dict[str, Any]) -> dict[str, Any]:
        if self.api_key == "":
            return _unavailable("not_configured")
        with_fallback = self.model in FALLBACK_MODELS
        body: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 8000,
            "system": SYSTEM,
            "output_config": {"effort": "low", "format": {"type": "json_schema", "schema": ANSWER_SCHEMA}},
            **({"fallbacks": "default"} if with_fallback else {}),
            "messages": [
                {
                    "role": "user",
                    "content": "Match these. Answer with JSON only.\n\n" + json.dumps(request, indent=2, ensure_ascii=False),
                }
            ],
        }
        headers = {
            "content-type": "application/json",
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            **({"anthropic-beta": "server-side-fallback-2026-07-01"} if with_fallback else {}),
        }
        http_request = urllib.request.Request(
            f"{self.base_url}/v1/messages", data=json.dumps(body).encode("utf8"), headers=headers, method="POST"
        )
        try:
            status, payload = self.transport(http_request, self.timeout_ms / 1000)
        except (TimeoutError, socket.timeout):
            return _unavailable("timeout")
        except (urllib.error.URLError, OSError) as error:
            reason = getattr(error, "reason", None)
            return _unavailable("timeout" if isinstance(reason, (TimeoutError, socket.timeout)) else "network")
        if status in (401, 403):
            return _unavailable("unauthorised")
        if status == 429:
            return _unavailable("rate_limited")
        if not 200 <= status < 300:
            return _unavailable("provider_error")
        try:
            message = json.loads(payload.decode("utf8"))
        except (ValueError, UnicodeDecodeError):
            return _unavailable("unreadable")
        if not isinstance(message, dict):
            return _unavailable("unreadable")
        # Before reading the content: a refusal or a cut-off answer need not match the schema.
        if message.get("stop_reason") == "refusal":
            return _unavailable("refused")
        if message.get("stop_reason") == "max_tokens":
            return _unavailable("truncated")
        text = next(
            (block.get("text") for block in message.get("content") or [] if isinstance(block, dict) and block.get("type") == "text"),
            None,
        )
        if not isinstance(text, str):
            return _unavailable("unreadable")
        try:
            parsed = json.loads(text)
        except ValueError:
            return _unavailable("unreadable")
        checked = _answer_shape.safe_parse(parsed)
        if not checked.success:
            return _unavailable("unreadable")
        return {"kind": "suggestions", "suggestions": checked.data["suggestions"]}


class BridgeMappingProvider:
    """A Node test's stand-in (`adapters/bridge.py`, NODE_ENV=test only)."""

    def __init__(self, url: str, props: dict[str, Any]) -> None:
        self.url = url
        self.name = props.get("name", "bridge")

    def propose(self, request: dict[str, Any]) -> dict[str, Any]:
        from .bridge import MISSING, call

        answer = call(self.url, "propose", request)
        if answer is MISSING or not isinstance(answer, dict):
            return _unavailable("provider_error")
        return answer


_current: list[Any] = [None]


def mapping_provider() -> Any:
    from .bridge import installed

    bridged = installed("mapping")
    if bridged is not None:
        return BridgeMappingProvider(bridged["url"], bridged.get("props") or {})
    if _current[0] is None:
        e = env()
        _current[0] = (
            ClaudeMappingProvider(
                api_key=e.MAPPING_API_KEY, model=e.MAPPING_MODEL, base_url=e.MAPPING_BASE_URL, timeout_ms=e.MAPPING_TIMEOUT_MS
            )
            if e.MAPPING_PROVIDER == "claude"
            else OffMappingProvider()
        )
    return _current[0]


def set_mapping_provider(provider: Any) -> None:
    _current[0] = provider


def reset_mapping_provider() -> Any:
    _current[0] = None
    return mapping_provider()


def propose_safely(request: dict[str, Any]) -> dict[str, Any]:
    """Asks the provider, and turns anything it raises into `unavailable`:
    an import never fails because a suggestion did."""
    try:
        return mapping_provider().propose(request)
    except Exception:
        return _unavailable("provider_error")
