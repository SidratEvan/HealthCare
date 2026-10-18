"""Django settings for the MedLiveBD API.

Everything that varies by deployment comes from the validated environment
(`medlive/core/env.py`), under the same names the Node API reads. Django's
own apps that this API does not use (auth, sessions, admin, the ORM's
migrations) are left out: the schema is owned by the SQL migrations in
`database/migrations`, and identity is the API's own (`core/auth.py`).
"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import unquote, urlsplit

from .core.env import env
from .core.logging import configure as configure_logging

BASE_DIR = Path(__file__).resolve().parent.parent
_env = env()

import os as _os  # noqa: E402

# Silent under test, as the Node logger is; MEDLIVE_TEST_LOGS=1 shows errors while debugging.
configure_logging(_env.LOG_LEVEL, silent=_env.NODE_ENV == "test" and _os.environ.get("MEDLIVE_TEST_LOGS") != "1")

# Django's own signing key is used for nothing this API exposes; derived from
# the access secret so no further variable is needed.
SECRET_KEY = "django-" + _env.JWT_ACCESS_SECRET
DEBUG = False
ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    "rest_framework",
    "medlive",
]

# The API's own pipeline (`core/pipeline.py`) does what middleware would:
# nothing here may run before it decides who is asking.
MIDDLEWARE: list[str] = []

ROOT_URLCONF = "medlive.urls"
ASGI_APPLICATION = "medlive.asgi.application"
WSGI_APPLICATION = None

_db = urlsplit(_env.DATABASE_URL)
_pool_max = _env.DATABASE_POOL_MAX

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": unquote(_db.path.lstrip("/").split("?")[0]),
        "USER": unquote(_db.username or ""),
        "PASSWORD": unquote(_db.password or ""),
        "HOST": _db.hostname or "localhost",
        "PORT": str(_db.port or 5432),
        "CONN_MAX_AGE": 0,
        "OPTIONS": {
            # PostGIS, pgcrypto and earthdistance live in `extensions`
            # (migration 0001); every statement is bounded at 15 s.
            "options": "-c search_path=public,extensions -c statement_timeout=15000",
            "application_name": "medlive-django-api",
            "connect_timeout": 5,
            "pool": {"min_size": 1, "max_size": _pool_max, "timeout": 5},
        },
        "TEST": {"NAME": None},
    }
}
if "sslmode=" in (_db.query or ""):
    for part in _db.query.split("&"):
        if part.startswith("sslmode="):
            DATABASES["default"]["OPTIONS"]["sslmode"] = part.split("=", 1)[1]

USE_TZ = True
TIME_ZONE = "UTC"
USE_I18N = False

# The pipeline parses and bounds bodies itself (256 kB, or a route's own).
DATA_UPLOAD_MAX_MEMORY_SIZE = 32 * 1024 * 1024
APPEND_SLASH = False

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
    "UNAUTHENTICATED_TOKEN": None,
}

LOGGING_CONFIG = None
# Django's own request log would print every 4xx to stderr; the pipeline logs
# each request once, structured and redacted (`core/logging.py`).
import logging as _logging  # noqa: E402

_logging.getLogger("django").setLevel(_logging.CRITICAL)
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
