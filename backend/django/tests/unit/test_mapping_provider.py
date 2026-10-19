"""The model adapter behind the import mapping (port of `mappingProvider.test.ts`;
`adapters/mapping.py`, FR-IMP-16, FR-IMP-17).

The network is stood in for: no test here calls a model. What is tested is
the contract on both sides of it: the request this server sends, and that
whatever comes back, or does not, becomes either a checked list of
suggestions or `unavailable`, and never an exception.
"""

from __future__ import annotations

import json
import socket
import urllib.error
from typing import Any, Callable

import pytest

from medlive.adapters.mapping import (
    ClaudeMappingProvider,
    OffMappingProvider,
    mapping_provider,
    propose_safely,
    reset_mapping_provider,
    set_mapping_provider,
)
from medlive.core.env import EnvError, load_env

REQUEST: dict[str, Any] = {
    "set": "patients",
    "rowType": None,
    "fields": [{"field": "ref", "required": True, "means": "The identifier the hospital uses."}],
    "columns": [{"index": 0, "heading": "MR#", "holds": "text", "filled": 1, "variety": "unique", "looksLike": None}],
    "alreadyMatched": [{"field": "mobile", "heading": "Pt. Cell"}],
}

OPTIONS: dict[str, Any] = {
    "api_key": "test-key-not-real",
    "model": "claude-opus-5-5",
    "base_url": "https://api.example.test",
    "timeout_ms": 5_000,
}


class Network:
    """Records what it was sent and answers as told."""

    def __init__(self, *, status: int = 200, json_body: Any = None, text: str | None = None, raises: BaseException | None = None):
        self.status = status
        self.payload = (text if text is not None else json.dumps(json_body if json_body is not None else {})).encode("utf8")
        self.raises = raises
        self.sent: list[dict[str, Any]] = []

    def __call__(self, request: Any, timeout: float) -> tuple[int, bytes]:
        self.sent.append(
            {
                "url": request.full_url,
                "headers": {key.lower(): value for key, value in request.header_items()},
                "body": json.loads(request.data.decode("utf8")),
                "timeout": timeout,
            }
        )
        if self.raises is not None:
            raise self.raises
        return self.status, self.payload


def _message(text: str, stop_reason: str = "end_turn") -> dict[str, Any]:
    return {
        "id": "msg_test",
        "model": "claude-opus-5-5",
        "stop_reason": stop_reason,
        "content": [{"type": "thinking", "thinking": ""}, {"type": "text", "text": text}],
    }


GOOD = json.dumps(
    {"suggestions": [{"field": "ref", "column": 0, "confidence": "high", "reason": "MR# is a medical record number."}]}
)


def _provider(network: Network, **overrides: Any) -> ClaudeMappingProvider:
    return ClaudeMappingProvider(**{**OPTIONS, **overrides}, transport=network)


def test_the_request_is_the_documented_messages_api_shape_with_a_json_answer_and_a_bounded_wait() -> None:
    network = Network(json_body=_message(GOOD))
    _provider(network).propose(REQUEST)
    assert len(network.sent) == 1
    sent = network.sent[0]
    assert sent["url"] == "https://api.example.test/v1/messages"
    assert sent["headers"]["x-api-key"] == "test-key-not-real"
    assert sent["headers"]["anthropic-version"] == "2023-06-01"
    assert sent["headers"]["content-type"] == "application/json"
    assert sent["timeout"] == 5
    body = sent["body"]
    assert body["model"] == "claude-opus-5-5"
    assert body["max_tokens"] == 8000
    assert body["output_config"]["effort"] == "low"
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert body["output_config"]["format"]["schema"]["type"] == "object"
    assert body["output_config"]["format"]["schema"]["additionalProperties"] is False
    # Nothing this model rejects: no thinking budget, sampling parameters, forced tool, prefill.
    for absent in ("thinking", "temperature", "top_p", "top_k", "tools", "tool_choice"):
        assert absent not in body, absent
    assert [entry["role"] for entry in body["messages"]] == ["user"]


def test_the_refusal_fallback_is_asked_for_only_on_a_model_that_has_it() -> None:
    with_it = Network(json_body=_message(GOOD))
    _provider(with_it).propose(REQUEST)
    assert with_it.sent[0]["body"]["fallbacks"] == "default"
    assert with_it.sent[0]["headers"]["anthropic-beta"] == "server-side-fallback-2026-07-01"

    without = Network(json_body=_message(GOOD))
    _provider(without, model="claude-haiku-4-5").propose(REQUEST)
    assert "fallbacks" not in without.sent[0]["body"]
    assert "anthropic-beta" not in without.sent[0]["headers"]


def test_it_sends_what_it_was_given_and_nothing_else_about_the_file() -> None:
    network = Network(json_body=_message(GOOD))
    _provider(network).propose(REQUEST)
    content = network.sent[0]["body"]["messages"][0]["content"]
    assert '"heading": "MR#"' in content
    assert '"means"' in content
    assert "national ID" in network.sent[0]["body"]["system"]
    assert "never given a value from the file" in network.sent[0]["body"]["system"]


def test_a_well_formed_answer_is_read() -> None:
    answer = _provider(Network(json_body=_message(GOOD))).propose(REQUEST)
    assert answer == {
        "kind": "suggestions",
        "suggestions": [{"field": "ref", "column": 0, "confidence": "high", "reason": "MR# is a medical record number."}],
    }


@pytest.mark.parametrize(
    ("name", "network", "reason"),
    [
        ("a refusal", lambda: Network(json_body=_message("", "refusal")), "refused"),
        ("an answer cut off", lambda: Network(json_body=_message('{"suggestions": [', "max_tokens")), "truncated"),
        ("text that is not JSON", lambda: Network(json_body=_message("Here are my suggestions!")), "unreadable"),
        ("JSON of another shape", lambda: Network(json_body=_message('{"mappings": {}}')), "unreadable"),
        (
            "a suggestion with a field outside the shape",
            lambda: Network(
                json_body=_message(
                    json.dumps({"suggestions": [{"field": "ref", "column": 0, "confidence": "certain", "reason": "x", "write": True}]})
                )
            ),
            "unreadable",
        ),
        ("a body that is not JSON at all", lambda: Network(text="<html>bad gateway</html>"), "unreadable"),
        ("no text block", lambda: Network(json_body={"stop_reason": "end_turn", "content": []}), "unreadable"),
        ("a wrong key", lambda: Network(status=401, json_body={"error": {"type": "authentication_error"}}), "unauthorised"),
        ("a rate limit", lambda: Network(status=429), "rate_limited"),
        ("an overloaded provider", lambda: Network(status=529), "provider_error"),
        ("a server error", lambda: Network(status=500), "provider_error"),
        ("a bad request", lambda: Network(status=400), "provider_error"),
        ("a wait that runs out", lambda: Network(raises=socket.timeout("timed out")), "timeout"),
        ("a network that is not there", lambda: Network(raises=urllib.error.URLError("unreachable")), "network"),
    ],
)
def test_what_comes_back_becomes_unavailable_never_an_exception(name: str, network: Callable[[], Network], reason: str) -> None:
    assert _provider(network()).propose(REQUEST) == {"kind": "unavailable", "reason": reason}, name


def test_with_no_key_nobody_is_asked() -> None:
    network = Network(json_body=_message(GOOD))
    assert _provider(network, api_key="").propose(REQUEST) == {"kind": "unavailable", "reason": "not_configured"}
    assert network.sent == []


def test_off_is_the_default_and_asks_nobody() -> None:
    reset_mapping_provider()
    assert isinstance(mapping_provider(), OffMappingProvider)
    assert propose_safely(REQUEST) == {"kind": "unavailable", "reason": "off"}


def test_a_provider_that_raises_is_still_not_an_error() -> None:
    class Broken:
        name = "broken"

        def propose(self, request: dict[str, Any]) -> dict[str, Any]:
            raise RuntimeError("a provider must not throw, and this one does")

    set_mapping_provider(Broken())
    try:
        assert propose_safely(REQUEST) == {"kind": "unavailable", "reason": "provider_error"}
    finally:
        reset_mapping_provider()


DEV = {
    "NODE_ENV": "development",
    "API_BASE_URL": "http://localhost:4000",
    "WEB_BASE_URL": "http://localhost:3000",
    "DATABASE_URL": "postgresql://healthcare:healthcare@localhost:5432/healthcare_dev",
    "JWT_ACCESS_SECRET": "a" * 32,
    "JWT_REFRESH_SECRET": "b" * 32,
    "GUEST_LINK_SECRET": "c" * 32,
}


def test_the_configuration_is_off_unless_set_on_the_current_opus_and_waits_twenty_seconds_at_most() -> None:
    loaded = load_env(dict(DEV))
    assert loaded.MAPPING_PROVIDER == "off"
    assert loaded.MAPPING_MODEL == "claude-opus-5-5"
    assert loaded.MAPPING_BASE_URL == "https://api.anthropic.com"
    assert loaded.MAPPING_TIMEOUT_MS == 20_000


def test_the_configuration_refuses_a_provider_it_does_not_know() -> None:
    with pytest.raises(EnvError):
        load_env({**DEV, "MAPPING_PROVIDER": "something-else"})
