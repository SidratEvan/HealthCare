"""Adapters a Node test installed, reached over a loopback callback (NODE_ENV=test only).

The Node API suite swaps an adapter in its own process (`setSmsAdapter`,
`setPaymentProvider`) and asserts on what the API made of its answers. Run
against this server, the suite says so in `x-medlive-test-adapters`
(`tests/node_suite/bridge.ts`), and the adapters here call that stand-in's
methods and return what it returned. Process-wide rather than per request,
because the sender thread sends after a request has answered; the suite runs
one test at a time and waits for the sender between tests.
"""

from __future__ import annotations

import json
import urllib.request
from typing import Any

MISSING: Any = object()

#: JavaScript's `undefined` as an argument (a signature header that was not sent).
UNDEFINED_ARG = {"$undefined": True}

_installed: dict[str, dict[str, Any]] = {}


def set_test_adapters(spec: dict[str, Any] | None) -> None:
    """Replaces what the suite says is installed; None or {} removes them all."""
    global _installed
    _installed = dict(spec or {})


def installed(kind: str) -> dict[str, Any] | None:
    return _installed.get(kind)


def call(url: str, method: str, *args: Any) -> Any:
    """The stand-in's answer; MISSING where it has no such method; its throw, raised."""
    request = urllib.request.Request(
        url,
        data=json.dumps({"method": method, "args": list(args)}, ensure_ascii=False).encode("utf8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as answer:  # noqa: S310 — a test-only loopback URL.
        result = json.loads(answer.read().decode("utf8"))
    if result.get("threw"):
        raise RuntimeError(result.get("message") or f"the test's adapter threw in {method}")
    if result.get("missing"):
        return MISSING
    return result.get("value")
