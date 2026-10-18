"""Environment validation (BACKEND.md §10; port of `backend/api/src/env.ts`).

Refuses to start when anything is wrong, and lists every problem at once. The
variable names are the Node API's, so a deployment's environment carries over
unchanged (`docs/django-migration/architecture.md` §Configuration).

Two deliberate differences from the Node API, both stricter:

- The `.env` read in development is `backend/django/.env`, never the
  repository root's. The root `.env` on the owner's machine points at the
  public Supabase demo database, and the migration must not reach it.
- Outside production, a `DATABASE_URL` that is not on this machine is refused
  unless `ALLOW_REMOTE_DB=1` says so on purpose (the guard the database
  scripts already apply, `database/scripts/lib/env.ts`).
"""

from __future__ import annotations

import dataclasses
import os
import re
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator, Mapping
from urllib.parse import urlsplit

from ..domain.phone import normalise_bd_mobile

MIN_SECRET_LENGTH = 32

_DURATION = re.compile(r"^[0-9]+[smhd]$")
_DOMAIN = re.compile(
    r"^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$"
)
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]"}

DJANGO_ROOT = Path(__file__).resolve().parents[2]


class EnvError(Exception):
    """Raised at boot, with every problem at once rather than the first."""

    def __init__(self, problems: list[tuple[str, str]]) -> None:
        self.problems = problems
        lines = [f"Environment is not valid ({len(problems)} problem(s)):", ""]
        lines += [f"  {key}: {message}" for key, message in problems]
        lines += ["", "See backend/django/.env.example for the full list (BACKEND.md §10)."]
        super().__init__("\n".join(lines))


@dataclass(frozen=True)
class Env:
    NODE_ENV: str
    PORT: int
    API_BASE_URL: str
    WEB_BASE_URL: str
    PLATFORM_DOMAIN: str
    CONSOLE_BASE_URL: str
    PLATFORM_FEE_POISHA: int
    DATABASE_URL: str
    DATABASE_POOL_MAX: int
    SUPABASE_URL: str
    SUPABASE_SERVICE_ROLE_KEY: str
    SUPABASE_STORAGE_BUCKET: str
    STORAGE_PROVIDER: str
    STORAGE_DIR: str
    STORAGE_URL_TTL_SECONDS: int
    JWT_ACCESS_SECRET: str
    JWT_REFRESH_SECRET: str
    JWT_ACCESS_TTL: str
    JWT_REFRESH_TTL: str
    STAFF_LOCKOUT_ATTEMPTS: int
    STAFF_LOCKOUT_MINUTES: int
    TOTP_ENCRYPTION_KEY: str
    GUEST_LINK_SECRET: str
    GUEST_LINK_TTL_DAYS: int
    OTP_TTL_SECONDS: int
    OTP_MAX_PER_HOUR: int
    SMS_PROVIDER: str
    SMS_API_URL: str
    SMS_API_KEY: str
    SMS_SENDER_ID: str
    SMS_DLR_SECRET: str
    SMS_MONTHLY_CAP: int
    VAPID_PUBLIC_KEY: str
    VAPID_PRIVATE_KEY: str
    VAPID_SUBJECT: str
    PAYMENT_PROVIDER: str
    MOCK_PAYMENT_FLOW: str
    BKASH_BASE_URL: str
    BKASH_APP_KEY: str
    BKASH_APP_SECRET: str
    BKASH_USERNAME: str
    BKASH_PASSWORD: str
    NAGAD_BASE_URL: str
    NAGAD_MERCHANT_ID: str
    NAGAD_MERCHANT_NUMBER: str
    NAGAD_PUBLIC_KEY: str
    NAGAD_PRIVATE_KEY: str
    TRAVEL_TIME_MODE: str
    MAPS_API_KEY: str
    STALE_THRESHOLD_MINUTES: int
    SENTRY_DSN: str
    LOG_LEVEL: str
    DEMO_MODE: bool
    SESSION_MATERIALISE: bool
    GUEST_BOOKING_OTP: bool | None
    #: None (the demonstration's own list), "any", or a tuple of phones.
    DEMO_PHONES: str | tuple[str, ...] | None
    GUEST_BOOKINGS_PER_PHONE_PER_DAY: int
    BACKUP_MAX_AGE_HOURS: int | None
    ORG_APPLICATIONS_OPEN_MAX: int
    TRUST_PROXY_HOPS: int
    ADDRESS_RATE_LIMIT_FACTOR: int
    MAPPING_PROVIDER: str
    MAPPING_API_KEY: str
    MAPPING_MODEL: str
    MAPPING_BASE_URL: str
    MAPPING_TIMEOUT_MS: int
    EXTRA_ALLOWED_ORIGINS: tuple[str, ...]
    #: Django-only: background timers in this process (the Node API always runs them).
    RUN_BACKGROUND_JOBS: bool = True
    extra: Mapping[str, str] = field(default_factory=dict)


def _load_dotenv(target: dict[str, str]) -> None:
    """Merges `backend/django/.env` into `target` without overwriting anything set."""
    path = DJANGO_ROOT / ".env"
    try:
        contents = path.read_text(encoding="utf8")
    except OSError:
        return
    for raw in re.split(r"\r?\n", contents):
        line = raw.strip()
        if line == "" or line.startswith("#"):
            continue
        sep = line.find("=")
        if sep == -1:
            continue
        key = line[:sep].strip()
        if key == "" or key in target:
            continue
        value = line[sep + 1 :].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        target[key] = value


def on_this_machine(url: str) -> bool:
    try:
        host = urlsplit(url).hostname
    except ValueError:
        return False
    return host in _LOCAL_HOSTS if host is not None else False


def _is_http_url(value: str) -> bool:
    try:
        parts = urlsplit(value)
    except ValueError:
        return False
    return parts.scheme in ("http", "https") and bool(parts.hostname)


def _is_exact_origin(value: str) -> bool:
    try:
        parts = urlsplit(value)
    except ValueError:
        return False
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return False
    default = {"http": 80, "https": 443}[parts.scheme]
    try:
        port = parts.port
    except ValueError:
        return False
    host = parts.hostname
    origin = f"{parts.scheme}://{host}" + ("" if port in (None, default) else f":{port}")
    return origin == value


class _Reader:
    def __init__(self, source: Mapping[str, str]) -> None:
        self.source = source
        self.problems: list[tuple[str, str]] = []

    def raw(self, key: str) -> str | None:
        value = self.source.get(key)
        return value

    def string(self, key: str, default: str = "") -> str:
        value = self.raw(key)
        return default if value is None else value

    def enum(self, key: str, options: tuple[str, ...], default: str) -> str:
        value = self.raw(key)
        if value is None:
            return default
        if value not in options:
            self.problems.append((key, f"must be one of {', '.join(options)}"))
            return default
        return value

    def integer(
        self,
        key: str,
        default: int | None,
        *,
        minimum: int | None = None,
        maximum: int | None = None,
        positive: bool = False,
    ) -> int | None:
        value = self.raw(key)
        if value is None:
            return default
        # `z.coerce.number().int()`: JavaScript's `Number(value)`, then whole.
        # "" is 0, " 10 " is 10, "1e3" is 1000, "1.5" and "ten" are refused.
        text = value.strip()
        try:
            as_float = 0.0 if text == "" else float(text)
        except ValueError:
            as_float = float("nan")
        if as_float != as_float or as_float in (float("inf"), float("-inf")) or not as_float.is_integer():
            self.problems.append((key, "must be a whole number"))
            return default
        number = int(as_float)
        if positive and number <= 0:
            self.problems.append((key, "must be greater than 0"))
            return default
        if minimum is not None and number < minimum:
            self.problems.append((key, f"must be at least {minimum}"))
            return default
        if maximum is not None and number > maximum:
            self.problems.append((key, f"must be at most {maximum}"))
            return default
        return number

    def boolish(self, key: str, default: bool | None) -> bool | None:
        value = self.raw(key)
        if value is None:
            return default
        if value not in ("true", "false"):
            self.problems.append((key, 'must be "true" or "false"'))
            return default
        return value == "true"

    def secret(self, key: str, *, allow_blank: bool = False) -> str:
        value = self.raw(key)
        if value is None:
            if allow_blank:
                return ""
            self.problems.append((key, "Required"))
            return ""
        if allow_blank and value == "":
            return ""
        if len(value) < MIN_SECRET_LENGTH:
            self.problems.append(
                (
                    key,
                    f"must be at least {MIN_SECRET_LENGTH} characters - generate one with: "
                    "python -c \"import secrets; print(secrets.token_hex(32))\"",
                )
            )
        return value

    def duration(self, key: str, default: str) -> str:
        value = self.string(key, default)
        if not _DURATION.fullmatch(value):
            self.problems.append((key, "must look like 15m, 24h or 30d"))
        return value

    def http_url(self, key: str, default: str) -> str:
        value = self.string(key, default)
        if not _is_http_url(value):
            self.problems.append(
                (key, "must be an absolute http(s) URL, e.g. https://api.example.com")
            )
        return value


def load_env(source: Mapping[str, str] | None = None) -> Env:
    """Parses and validates the environment, or raises `EnvError`."""
    if source is None:
        merged = dict(os.environ)
        if merged.get("NODE_ENV") != "production":
            _load_dotenv(merged)
        source = merged
    r = _Reader(source)

    node_env = r.enum("NODE_ENV", ("development", "test", "production"), "development")

    platform_domain = r.string("PLATFORM_DOMAIN").strip().lower()
    if platform_domain not in ("", "localhost") and not _DOMAIN.fullmatch(platform_domain):
        r.problems.append(
            ("PLATFORM_DOMAIN", "must be a domain name with no scheme or path, e.g. medlivebd.example")
        )

    database_url = r.string("DATABASE_URL")
    if database_url == "":
        r.problems.append(("DATABASE_URL", "Required"))

    demo_phones_raw = (r.raw("DEMO_PHONES") or "").strip()
    demo_phones: str | tuple[str, ...] | None
    if demo_phones_raw == "":
        demo_phones = None
    elif demo_phones_raw == "any":
        demo_phones = "any"
    else:
        phones: list[str] = []
        for entry in demo_phones_raw.split(","):
            if entry.strip() == "":
                continue
            phone = normalise_bd_mobile(entry.strip())
            if phone is None:
                r.problems.append(("DEMO_PHONES", f"not a Bangladeshi mobile: {entry.strip()}"))
                break
            phones.append(phone)
        demo_phones = tuple(phones)

    extra_origins = tuple(
        entry.strip() for entry in r.string("EXTRA_ALLOWED_ORIGINS").split(",") if entry.strip()
    )
    for index, origin in enumerate(extra_origins):
        if not _is_exact_origin(origin):
            r.problems.append(
                (
                    f"EXTRA_ALLOWED_ORIGINS.{index}",
                    "must be an origin only, e.g. https://padma.example.com, with no path or trailing slash",
                )
            )

    mapping_model = r.string("MAPPING_MODEL", "claude-opus-5-5").strip()
    if mapping_model == "":
        r.problems.append(("MAPPING_MODEL", "must not be empty"))

    env = Env(
        NODE_ENV=node_env,
        PORT=r.integer("PORT", 4000, minimum=1, maximum=65_535) or 4000,
        API_BASE_URL=r.http_url("API_BASE_URL", "http://localhost:4000"),
        WEB_BASE_URL=r.http_url("WEB_BASE_URL", "http://localhost:3000"),
        PLATFORM_DOMAIN=platform_domain,
        CONSOLE_BASE_URL=r.http_url("CONSOLE_BASE_URL", "http://localhost:3100"),
        PLATFORM_FEE_POISHA=r.integer("PLATFORM_FEE_POISHA", 0, minimum=0) or 0,
        DATABASE_URL=database_url,
        DATABASE_POOL_MAX=r.integer("DATABASE_POOL_MAX", 10, positive=True, maximum=200) or 10,
        SUPABASE_URL=r.string("SUPABASE_URL"),
        SUPABASE_SERVICE_ROLE_KEY=r.string("SUPABASE_SERVICE_ROLE_KEY"),
        SUPABASE_STORAGE_BUCKET=r.string("SUPABASE_STORAGE_BUCKET", "healthcare-dev"),
        STORAGE_PROVIDER=r.enum("STORAGE_PROVIDER", ("mock", "local", "supabase"), "mock"),
        STORAGE_DIR=r.string("STORAGE_DIR", "./storage") or "./storage",
        STORAGE_URL_TTL_SECONDS=r.integer(
            "STORAGE_URL_TTL_SECONDS", 900, positive=True, maximum=86_400
        )
        or 900,
        JWT_ACCESS_SECRET=r.secret("JWT_ACCESS_SECRET"),
        JWT_REFRESH_SECRET=r.secret("JWT_REFRESH_SECRET"),
        JWT_ACCESS_TTL=r.duration("JWT_ACCESS_TTL", "15m"),
        JWT_REFRESH_TTL=r.duration("JWT_REFRESH_TTL", "30d"),
        STAFF_LOCKOUT_ATTEMPTS=r.integer("STAFF_LOCKOUT_ATTEMPTS", 5, positive=True, maximum=50)
        or 5,
        STAFF_LOCKOUT_MINUTES=r.integer("STAFF_LOCKOUT_MINUTES", 15, positive=True, maximum=1_440)
        or 15,
        TOTP_ENCRYPTION_KEY=r.secret("TOTP_ENCRYPTION_KEY", allow_blank=True),
        GUEST_LINK_SECRET=r.secret("GUEST_LINK_SECRET"),
        GUEST_LINK_TTL_DAYS=r.integer("GUEST_LINK_TTL_DAYS", 30, positive=True, maximum=365) or 30,
        OTP_TTL_SECONDS=r.integer("OTP_TTL_SECONDS", 300, positive=True, maximum=3_600) or 300,
        OTP_MAX_PER_HOUR=r.integer("OTP_MAX_PER_HOUR", 5, positive=True, maximum=100) or 5,
        SMS_PROVIDER=r.enum("SMS_PROVIDER", ("http", "local", "log"), "log"),
        SMS_API_URL=r.string("SMS_API_URL"),
        SMS_API_KEY=r.string("SMS_API_KEY"),
        SMS_SENDER_ID=r.string("SMS_SENDER_ID"),
        SMS_DLR_SECRET=r.string("SMS_DLR_SECRET"),
        SMS_MONTHLY_CAP=r.integer("SMS_MONTHLY_CAP", 20_000, positive=True) or 20_000,
        VAPID_PUBLIC_KEY=r.string("VAPID_PUBLIC_KEY"),
        VAPID_PRIVATE_KEY=r.string("VAPID_PRIVATE_KEY"),
        VAPID_SUBJECT=r.string("VAPID_SUBJECT"),
        PAYMENT_PROVIDER=r.enum("PAYMENT_PROVIDER", ("mock", "live", "off"), "mock"),
        MOCK_PAYMENT_FLOW=r.enum("MOCK_PAYMENT_FLOW", ("inline", "redirect"), "inline"),
        BKASH_BASE_URL=r.string("BKASH_BASE_URL"),
        BKASH_APP_KEY=r.string("BKASH_APP_KEY"),
        BKASH_APP_SECRET=r.string("BKASH_APP_SECRET"),
        BKASH_USERNAME=r.string("BKASH_USERNAME"),
        BKASH_PASSWORD=r.string("BKASH_PASSWORD"),
        NAGAD_BASE_URL=r.string("NAGAD_BASE_URL"),
        NAGAD_MERCHANT_ID=r.string("NAGAD_MERCHANT_ID"),
        NAGAD_MERCHANT_NUMBER=r.string("NAGAD_MERCHANT_NUMBER"),
        NAGAD_PUBLIC_KEY=r.string("NAGAD_PUBLIC_KEY"),
        NAGAD_PRIVATE_KEY=r.string("NAGAD_PRIVATE_KEY"),
        TRAVEL_TIME_MODE=r.enum("TRAVEL_TIME_MODE", ("static", "api"), "static"),
        MAPS_API_KEY=r.string("MAPS_API_KEY"),
        STALE_THRESHOLD_MINUTES=r.integer(
            "STALE_THRESHOLD_MINUTES", 10, positive=True, maximum=1_440
        )
        or 10,
        SENTRY_DSN=r.string("SENTRY_DSN"),
        LOG_LEVEL=r.enum(
            "LOG_LEVEL", ("trace", "debug", "info", "warn", "error", "fatal"), "info"
        ),
        DEMO_MODE=bool(r.boolish("DEMO_MODE", False)),
        SESSION_MATERIALISE=bool(r.boolish("SESSION_MATERIALISE", True)),
        GUEST_BOOKING_OTP=r.boolish("GUEST_BOOKING_OTP", None),
        DEMO_PHONES=demo_phones,
        GUEST_BOOKINGS_PER_PHONE_PER_DAY=r.integer(
            "GUEST_BOOKINGS_PER_PHONE_PER_DAY", 10, positive=True, maximum=1_000
        )
        or 10,
        BACKUP_MAX_AGE_HOURS=r.integer(
            "BACKUP_MAX_AGE_HOURS", None, positive=True, maximum=24 * 14
        ),
        ORG_APPLICATIONS_OPEN_MAX=r.integer(
            "ORG_APPLICATIONS_OPEN_MAX", 200, positive=True, maximum=10_000
        )
        or 200,
        TRUST_PROXY_HOPS=r.integer("TRUST_PROXY_HOPS", 0, minimum=0, maximum=3) or 0,
        ADDRESS_RATE_LIMIT_FACTOR=r.integer(
            "ADDRESS_RATE_LIMIT_FACTOR", 1, positive=True, maximum=100
        )
        or 1,
        MAPPING_PROVIDER=r.enum("MAPPING_PROVIDER", ("off", "claude"), "off"),
        MAPPING_API_KEY=r.string("MAPPING_API_KEY"),
        MAPPING_MODEL=mapping_model,
        MAPPING_BASE_URL=r.http_url("MAPPING_BASE_URL", "https://api.anthropic.com"),
        MAPPING_TIMEOUT_MS=r.integer("MAPPING_TIMEOUT_MS", 20_000, positive=True, maximum=120_000)
        or 20_000,
        EXTRA_ALLOWED_ORIGINS=extra_origins,
        RUN_BACKGROUND_JOBS=bool(r.boolish("RUN_BACKGROUND_JOBS", True)),
    )

    if r.problems:
        raise EnvError(r.problems)

    problems: list[tuple[str, str]] = []

    if env.DEMO_PHONES == "any" and not on_this_machine(env.DATABASE_URL):
        problems.append(
            (
                "DEMO_PHONES",
                '"any" is accepted only with a local database - elsewhere a demonstration '
                "would store any number typed into it (FR-DEM-08)",
            )
        )

    # Django-only guard (module docstring): no remote database by accident.
    if (
        env.NODE_ENV != "production"
        and not on_this_machine(env.DATABASE_URL)
        and source.get("ALLOW_REMOTE_DB") != "1"
    ):
        problems.append(
            (
                "DATABASE_URL",
                "is not on this machine; outside production that needs ALLOW_REMOTE_DB=1 "
                "on purpose (the public demo database must never be reached by accident)",
            )
        )

    if env.NODE_ENV == "production":
        for key, because, unless in _PRODUCTION_REQUIREMENTS:
            if unless is not None and unless(env):
                continue
            if getattr(env, key) == "":
                problems.append((key, f"required in production - without it, {because}"))
        if env.DEMO_MODE:
            problems.append(
                (
                    "DEMO_MODE",
                    "must be false in production - it permits database reset and mock payments (FR-SEC-08)",
                )
            )
        if env.PAYMENT_PROVIDER == "mock":
            problems.append(
                (
                    "PAYMENT_PROVIDER",
                    'must be "live" or "off" in production - the mock adapter approves every payment',
                )
            )
        if env.STORAGE_PROVIDER == "mock":
            problems.append(
                (
                    "STORAGE_PROVIDER",
                    'must be "local" or "supabase" in production - the mock store keeps report files '
                    "in process memory, so a restart loses every report a lab uploaded (FR-LAB-03)",
                )
            )
        if env.STORAGE_PROVIDER == "supabase":
            problems.append(
                (
                    "STORAGE_PROVIDER",
                    'must be "local" in production - this version has no Supabase Storage adapter, '
                    "so every lab report and patient document upload would be refused (FR-LAB-03, FR-PAT-62)",
                )
            )
        if env.JWT_ACCESS_SECRET == env.JWT_REFRESH_SECRET:
            problems.append(
                (
                    "JWT_REFRESH_SECRET",
                    "must differ from JWT_ACCESS_SECRET - sharing them lets a 15-minute access token "
                    "be replayed as a 30-day refresh token",
                )
            )
        token_keys = (env.JWT_ACCESS_SECRET, env.JWT_REFRESH_SECRET)
        if env.GUEST_LINK_SECRET in token_keys:
            problems.append(
                (
                    "GUEST_LINK_SECRET",
                    "must differ from both JWT secrets - a tracking link is signed with its own key",
                )
            )
        if env.TOTP_ENCRYPTION_KEY != "" and env.TOTP_ENCRYPTION_KEY in (
            *token_keys,
            env.GUEST_LINK_SECRET,
        ):
            problems.append(
                (
                    "TOTP_ENCRYPTION_KEY",
                    "must differ from the JWT and tracking-link secrets - it encrypts what a second "
                    "factor is made from (FR-SEC-10)",
                )
            )

    if problems:
        raise EnvError(problems)
    return env


_PRODUCTION_REQUIREMENTS = (
    (
        "SUPABASE_URL",
        "reports and prescriptions have nowhere to be stored",
        lambda env: env.STORAGE_PROVIDER != "supabase",
    ),
    (
        "SUPABASE_SERVICE_ROLE_KEY",
        "signed URLs cannot be issued, so no patient could open a report",
        lambda env: env.STORAGE_PROVIDER != "supabase",
    ),
    (
        "SMS_API_KEY",
        "a guest booking produces an SMS tracking link, and without it the patient has no way "
        "to follow their serial (FR-GST-05)",
        lambda env: env.SMS_PROVIDER == "log",
    ),
    (
        "SMS_SENDER_ID",
        "the aggregator rejects messages without a registered sender",
        lambda env: env.SMS_PROVIDER == "log",
    ),
    (
        "SMS_API_URL",
        "SMS_PROVIDER=http sends to this address, and without it no message leaves",
        lambda env: env.SMS_PROVIDER != "http",
    ),
    (
        "SMS_DLR_SECRET",
        "delivery receipts are believed only when signed with it, and without it every one "
        "is refused (FR-NOT-06)",
        lambda env: env.SMS_PROVIDER != "http",
    ),
    (
        "TOTP_ENCRYPTION_KEY",
        "administrators' second factors would be encrypted with a key derived from "
        "JWT_REFRESH_SECRET, and rotating that secret would lock every one of them out (FR-SEC-10)",
        None,
    ),
    (
        "MAPPING_API_KEY",
        "MAPPING_PROVIDER names a model and there is no key to ask it with; set the key, or "
        "MAPPING_PROVIDER=off, which needs none (FR-IMP-16)",
        lambda env: env.MAPPING_PROVIDER == "off",
    ),
)


_env: Env | None = None

#: The test seam's per-request environment (`core/pipeline.py`, NODE_ENV=test
#: only): the Node suite changes `env` in its own process, and each request it
#: sends says what it changed (`tests/node_suite/app-shim.ts`).
_override: ContextVar[Env | None] = ContextVar("medlive_env_override", default=None)


def env() -> Env:
    """The validated environment, read once."""
    global _env
    overridden = _override.get()
    if overridden is not None:
        return overridden
    if _env is None:
        _env = load_env()
    return _env


@contextmanager
def env_overridden(changes: Mapping[str, Any]) -> Iterator[None]:
    """This context's environment with `changes` applied (unknown names ignored)."""
    base = env()
    known = {f.name for f in dataclasses.fields(base)}
    applied = {name: value for name, value in changes.items() if name in known}
    token = _override.set(dataclasses.replace(base, **applied) if applied else base)
    try:
        yield
    finally:
        _override.reset(token)


def is_production() -> bool:
    return env().NODE_ENV == "production"


def is_test() -> bool:
    return env().NODE_ENV == "test"
