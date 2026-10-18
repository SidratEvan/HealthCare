"""JSON over HTTPS for the payment providers, with a timeout (stdlib only)."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

TIMEOUT_SECONDS = 15


def send(method: str, url: str, body: Any, headers: dict[str, str]) -> dict[str, Any]:
    data = None if body is None else json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json", "Accept": "application/json", **headers},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            raw = response.read()
            status = response.status
    except urllib.error.HTTPError as error:
        raw = error.read()
        status = error.code
    try:
        parsed = json.loads(raw.decode("utf8"))
    except ValueError:
        parsed = None
    if not isinstance(parsed, dict):
        raise RuntimeError(f"http_{status}")
    return parsed
