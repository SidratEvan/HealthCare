"""Staff password hashing (port of `config/password.ts`; FR-SEC-06, CLAUDE.md §4.1).

scrypt from the standard library, N=2^17, r=8, p=1, a 16-byte salt and a
64-byte key, over the NFKC form of the password. Stored as
`scrypt$N$r$p$<salt b64>$<key b64>`, the same string the Node API writes, so a
hash made by either verifies in the other.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import secrets
import threading
import unicodedata

PREFIX = "scrypt"
SCRYPT_PARAMS = {"N": 2**17, "r": 8, "p": 1}
SALT_BYTES = 16
KEY_BYTES = 64
MIN_PASSWORD_LENGTH = 10


def _maxmem_for(n: int, r: int) -> int:
    return 128 * n * r + 1024 * 1024


def _derive(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(
        unicodedata.normalize("NFKC", password).encode("utf8"),
        salt=salt,
        n=n,
        r=r,
        p=p,
        maxmem=_maxmem_for(n, r),
        dklen=KEY_BYTES,
    )


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(SALT_BYTES)
    n, r, p = SCRYPT_PARAMS["N"], SCRYPT_PARAMS["r"], SCRYPT_PARAMS["p"]
    key = _derive(password, salt, n, r, p)
    return "$".join(
        [PREFIX, str(n), str(r), str(p), base64.b64encode(salt).decode("ascii"), base64.b64encode(key).decode("ascii")]
    )


def _b64(text: str) -> bytes:
    # Buffer.from(text, 'base64') is lenient; a malformed tail decodes to fewer bytes.
    try:
        return base64.b64decode(text + "=" * (-len(text) % 4))
    except (binascii.Error, ValueError):
        return b""


def _parse(stored: str) -> dict | None:
    parts = stored.split("$")
    if len(parts) != 6 or parts[0] != PREFIX:
        return None
    _, n_text, r_text, p_text, salt, key = parts
    values = []
    for text in (n_text, r_text, p_text):
        try:
            value = float(text) if text.strip() != "" else float("nan")
        except ValueError:
            return None
        if not value.is_integer() or value <= 0:
            return None
        values.append(int(value))
    n, r, p = values
    if n < 2 or (n & (n - 1)) != 0:
        return None
    if salt == "" or key == "":
        return None
    return {"N": n, "r": r, "p": p, "salt": _b64(salt), "key": _b64(key)}


def verify_password(password: str, stored: str | None) -> bool:
    if stored is None:
        return False
    parsed = _parse(stored)
    if parsed is None or len(parsed["key"]) == 0:
        return False
    try:
        candidate = _derive(password, parsed["salt"], parsed["N"], parsed["r"], parsed["p"])
    except (ValueError, MemoryError):
        return False
    return len(candidate) == len(parsed["key"]) and hmac.compare_digest(candidate, parsed["key"])


def needs_rehash(stored: str) -> bool:
    parsed = _parse(stored)
    if parsed is None:
        return False
    return parsed["N"] < SCRYPT_PARAMS["N"] or parsed["r"] < SCRYPT_PARAMS["r"] or parsed["p"] < SCRYPT_PARAMS["p"]


_decoy: str | None = None
_decoy_lock = threading.Lock()


def burn_verification(password: str) -> None:
    """Spends the time a real check would, so an unknown email is not faster to refuse."""
    global _decoy
    with _decoy_lock:
        if _decoy is None:
            _decoy = hash_password("decoy-password-never-matches")
        decoy = _decoy
    verify_password(password, decoy)


def password_problem(next_password: str, current: str | None = None) -> str | None:
    normal = unicodedata.normalize("NFKC", next_password)
    if len(normal) < MIN_PASSWORD_LENGTH:
        return "too_short"
    if current is not None and normal == unicodedata.normalize("NFKC", current):
        return "unchanged"
    return None


TEMPORARY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"


def temporary_password(length: int = 14) -> str:
    size = len(TEMPORARY_ALPHABET)
    limit = 256 - (256 % size)
    out = ""
    while len(out) < length:
        for byte in secrets.token_bytes(length * 2):
            if byte < limit and len(out) < length:
                out += TEMPORARY_ALPHABET[byte % size]
    return out
