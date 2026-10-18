"""What a stored document is, by its first bytes (port of `clinical/documents.ts`; FR-PAT-40, FR-LAB-04)."""

from __future__ import annotations

DOCUMENT_CONTENT_TYPES = ("image/jpeg", "image/png", "image/webp", "application/pdf")
DOCUMENT_KINDS = ("prescription", "report", "discharge", "other")
MAX_DOCUMENT_BYTES = 8 * 1024 * 1024

_EXTENSION = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf"}


def _starts_with(data: bytes, prefix: bytes, at: int = 0) -> bool:
    return data[at : at + len(prefix)] == prefix


def sniff_document(data: bytes) -> str | None:
    """The type the bytes say they are, whatever the upload claimed."""
    if _starts_with(data, b"\xff\xd8\xff"):
        return "image/jpeg"
    if _starts_with(data, b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if _starts_with(data, b"RIFF") and _starts_with(data, b"WEBP", 8):
        return "image/webp"
    if _starts_with(data, b"%PDF-"):
        return "application/pdf"
    return None


def document_key(patient_id: str, document_id: str, content_type: str) -> str:
    return f"documents/{patient_id}/{document_id}.{_EXTENSION[content_type]}"
