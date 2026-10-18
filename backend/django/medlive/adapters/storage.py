"""Where report and document files are kept (port of `adapters/storage.ts`; FR-LAB-04, FR-PAT-40).

`mock` keeps files in this process's memory (the demonstration and tests);
`local` writes them under `STORAGE_DIR` (a hospital's own server, DEPLOY.md
Part S). Either way a file is reached only through a short-lived signed URL
(`/files/<key>?expires=&sig=`), signed with the access-token secret.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import math
import os
import threading
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

from ..core.env import env
from ..core.logging import logger
from ..domain.time import now_ms


def _sign(key: str, expires_at: int) -> str:
    digest = hmac.new(
        env().JWT_ACCESS_SECRET.encode("utf8"), f"{key}:{expires_at}".encode("utf8"), hashlib.sha256
    ).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _js_number_text(value: float) -> str:
    # `String(expiresAt)` for the number the route parsed.
    return str(int(value)) if float(value).is_integer() else repr(value)


def verify_file_signature(key: str, expires_at: float, signature: str) -> dict[str, Any]:
    if not math.isfinite(expires_at) or expires_at * 1000 < now_ms():
        return {"ok": False, "reason": "expired"}
    expected_digest = hmac.new(
        env().JWT_ACCESS_SECRET.encode("utf8"),
        f"{key}:{_js_number_text(expires_at)}".encode("utf8"),
        hashlib.sha256,
    ).digest()
    expected = base64.urlsafe_b64encode(expected_digest).rstrip(b"=")
    presented = signature.encode("utf8")
    if len(expected) != len(presented) or not hmac.compare_digest(expected, presented):
        return {"ok": False, "reason": "bad_signature"}
    return {"ok": True}


def _encode_uri_component(value: str) -> str:
    return quote(value, safe="-_.!~*'()")


def _mock_url_for(key: str) -> str:
    expires_at = math.floor(now_ms() / 1000) + env().STORAGE_URL_TTL_SECONDS
    params = urlencode({"expires": str(expires_at), "sig": _sign(key, expires_at)})
    return f"/files/{_encode_uri_component(key)}?{params}"


DEMO_REPORT_PREFIX = "reports/demo/"
DEMO_DOCUMENT_PREFIX = "documents/demo/"


def demo_report_pdf() -> bytes:
    """A one-page PDF that says, in its own words, that it is not a real result (FR-DEM-07)."""
    heading = "DEMONSTRATION DATA - NOT A REAL TEST RESULT"
    body = "This platform is running on seeded demo data (FR-DEM-07)."
    content = "\n".join(["BT", "/F1 14 Tf 56 760 Td", f"({heading}) Tj", "/F1 10 Tf 0 -28 Td", f"({body}) Tj", "ET"])
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        f"<< /Length {len(content)} >>\nstream\n{content}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    pdf = "%PDF-1.4\n"
    offsets: list[int] = []
    for index, obj in enumerate(objects):
        offsets.append(len(pdf))
        pdf += f"{index + 1} 0 obj\n{obj}\nendobj\n"
    startxref = len(pdf)
    pdf += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n"
    for offset in offsets:
        pdf += f"{str(offset).rjust(10, '0')} 00000 n \n"
    pdf += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
    pdf += f"startxref\n{startxref}\n%%EOF\n"
    return pdf.encode("latin-1")


class MockStorageAdapter:
    name = "mock"

    def __init__(self) -> None:
        self._files: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def put(self, *, key: str, content_type: str, data: bytes) -> dict[str, Any]:
        with self._lock:
            self._files[key] = {"contentType": content_type, "bytes": data}
        logger.info({"key": key, "bytes": len(data)}, "file stored")
        return {"key": key, "url": _mock_url_for(key), "bytes": len(data)}

    def signed_url(self, key: str) -> str:
        return _mock_url_for(key)

    def get(self, key: str) -> dict[str, Any] | None:
        with self._lock:
            held = self._files.get(key)
        if held is not None:
            return held
        if key.startswith(DEMO_REPORT_PREFIX) or key.startswith(DEMO_DOCUMENT_PREFIX):
            return {"contentType": "application/pdf", "bytes": demo_report_pdf()}
        return None

    def size(self) -> int:
        return len(self._files)


class LocalStorageAdapter:
    name = "local"

    def __init__(self, root: str) -> None:
        self.root = root

    def _path_of(self, key: str) -> Path:
        base = os.path.realpath(self.root)
        full = os.path.realpath(os.path.join(base, key))
        if not full.startswith(base + os.sep):
            raise ValueError("storage_key_outside_directory")
        return Path(full)

    def put(self, *, key: str, content_type: str, data: bytes) -> dict[str, Any]:
        path = self._path_of(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        Path(f"{path}.type").write_text(content_type, encoding="utf8")
        logger.info({"key": key, "bytes": len(data)}, "file stored")
        return {"key": key, "url": _mock_url_for(key), "bytes": len(data)}

    def signed_url(self, key: str) -> str:
        return _mock_url_for(key)

    def get(self, key: str) -> dict[str, Any] | None:
        try:
            path = self._path_of(key)
            return {"contentType": Path(f"{path}.type").read_text(encoding="utf8"), "bytes": path.read_bytes()}
        except (OSError, ValueError):
            return None


class UnconfiguredStorageAdapter:
    name = "unconfigured"

    def put(self, **_: Any) -> dict[str, Any]:
        raise RuntimeError("no_storage_provider_configured")

    def signed_url(self, key: str) -> str:
        raise RuntimeError("no_storage_provider_configured")

    def get(self, key: str) -> dict[str, Any] | None:
        return None


_current: Any = None
_lock = threading.Lock()


def storage() -> Any:
    global _current
    with _lock:
        if _current is None:
            provider = env().STORAGE_PROVIDER
            if provider == "mock":
                _current = MockStorageAdapter()
            elif provider == "local":
                _current = LocalStorageAdapter(env().STORAGE_DIR)
            else:
                _current = UnconfiguredStorageAdapter()
        return _current


def set_storage_adapter(adapter: Any) -> None:
    global _current
    _current = adapter


def reset_storage_adapter() -> Any:
    global _current
    _current = None
    return storage()
