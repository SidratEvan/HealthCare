"""Staff second factor: TOTP and recovery codes (port of `config/totp.ts`; FR-SUP-01, FR-SEC-06).

RFC 6238, SHA-1, six digits, thirty seconds, one step either side, and a step
never accepted twice. The secret is stored sealed with AES-256-GCM under a key
derived by HKDF from `TOTP_ENCRYPTION_KEY` (or the refresh secret when that is
blank), in the Node API's format `v1.<iv>.<tag>.<body>`, so either API opens
what the other sealed.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import struct
from base64 import urlsafe_b64decode, urlsafe_b64encode
from urllib.parse import quote, urlencode

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from .env import env

TOTP = {"digits": 6, "periodSeconds": 30, "algorithm": "SHA1"}
WINDOW_STEPS = 1
SECRET_BYTES = 20
BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"


def base32_encode(data: bytes) -> str:
    bits = 0
    value = 0
    out = ""
    for byte in data:
        value = ((value << 8) | byte) & 0xFFFFFFFF
        bits += 8
        while bits >= 5:
            out += BASE32[(value >> (bits - 5)) & 31]
            bits -= 5
    if bits > 0:
        out += BASE32[(value << (5 - bits)) & 31]
    return out


def base32_decode(text: str) -> bytes:
    clean = re.sub(r"[\s=]", "", text).upper()
    bits = 0
    value = 0
    out = bytearray()
    for char in clean:
        index = BASE32.find(char)
        if index == -1:
            raise ValueError("not base32")
        value = ((value << 5) | index) & 0xFFFFFFFF
        bits += 5
        if bits >= 8:
            out.append((value >> (bits - 8)) & 255)
            bits -= 8
    return bytes(out)


def new_totp_secret() -> str:
    return base32_encode(secrets.token_bytes(SECRET_BYTES))


def step_at(ms: float) -> int:
    return int(ms // 1_000 // TOTP["periodSeconds"])


def code_at(secret: str, step: int) -> str:
    digest = hmac.new(base32_decode(secret), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(binary % 10 ** TOTP["digits"]).rjust(TOTP["digits"], "0")


def _same_code(a: str, b: str) -> bool:
    left, right = a.encode("utf8"), b.encode("utf8")
    return len(left) == len(right) and hmac.compare_digest(left, right)


_SIX_DIGITS = re.compile(r"^[0-9]{6}\Z")


def match_step(secret: str, code: str, now: float, last_step: int | None) -> int | None:
    if not _SIX_DIGITS.match(code):
        return None
    current = step_at(now)
    for offset in range(-WINDOW_STEPS, WINDOW_STEPS + 1):
        step = current + offset
        if last_step is not None and step <= last_step:
            continue
        if _same_code(code_at(secret, step), code):
            return step
    return None


def _encode_uri_component(value: str) -> str:
    return quote(value, safe="-_.!~*'()")


def otpauth_uri(*, secret: str, account: str, issuer: str) -> str:
    issuer = issuer.replace(":", " ").strip()
    account = account.replace(":", " ").strip()
    label = f"{_encode_uri_component(issuer)}:{_encode_uri_component(account)}"
    query = urlencode(
        {
            "secret": secret,
            "issuer": issuer,
            "algorithm": TOTP["algorithm"],
            "digits": str(TOTP["digits"]),
            "period": str(TOTP["periodSeconds"]),
        }
    )
    return f"otpauth://totp/{label}?{query}"


_cached_for: str | None = None
_cached: dict[str, bytes] | None = None


def _keys() -> dict[str, bytes]:
    global _cached, _cached_for
    own = env().TOTP_ENCRYPTION_KEY != ""
    material = env().TOTP_ENCRYPTION_KEY if own else env().JWT_REFRESH_SECRET
    cache_key = f"{'own' if own else 'derived'}:{material}"
    if _cached is not None and _cached_for == cache_key:
        return _cached
    context = "staff-totp" if own else "staff-totp-derived"

    def derive(purpose: str) -> bytes:
        return HKDF(algorithm=hashes.SHA256(), length=32, salt=b"", info=f"{context}:{purpose}:v1".encode("utf8")).derive(
            material.encode("utf8")
        )

    _cached = {"seal": derive("seal"), "recovery": derive("recovery")}
    _cached_for = cache_key
    return _cached


def _b64url(data: bytes) -> str:
    return urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _from_b64url(text: str) -> bytes:
    return urlsafe_b64decode(text + "=" * (-len(text) % 4))


def seal_secret(secret: str) -> str:
    iv = secrets.token_bytes(12)
    sealed = AESGCM(_keys()["seal"]).encrypt(iv, secret.encode("utf8"), None)
    body, tag = sealed[:-16], sealed[-16:]
    return ".".join(["v1", _b64url(iv), _b64url(tag), _b64url(body)])


def open_secret(sealed: str) -> str:
    parts = sealed.split(".")
    if len(parts) < 4 or parts[0] != "v1":
        raise ValueError("not a sealed TOTP secret")
    _, iv, tag, body = parts[:4]
    try:
        return AESGCM(_keys()["seal"]).decrypt(_from_b64url(iv), _from_b64url(body) + _from_b64url(tag), None).decode(
            "utf8"
        )
    except Exception as cause:  # noqa: BLE001 — any failure is "does not open with this key".
        raise ValueError("TOTP secret does not open") from cause


RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
RECOVERY_LENGTH = 12
RECOVERY_CODE_COUNT = 10


def new_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    codes = []
    for _ in range(count):
        code = "".join(RECOVERY_ALPHABET[secrets.randbelow(len(RECOVERY_ALPHABET))] for _ in range(RECOVERY_LENGTH))
        codes.append(f"{code[0:4]}-{code[4:8]}-{code[8:]}")
    return codes


def normalise_recovery_code(typed: str) -> str | None:
    clean = re.sub(r"[\s-]", "", typed.lower())
    if len(clean) != RECOVERY_LENGTH:
        return None
    return clean if all(char in RECOVERY_ALPHABET for char in clean) else None


def recovery_hash(code: str) -> str:
    normal = normalise_recovery_code(code) or code
    return hmac.new(_keys()["recovery"], normal.encode("utf8"), hashlib.sha256).hexdigest()
