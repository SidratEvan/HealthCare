"""Settings for `pytest`: the Node API suite's test environment, then the real settings.

`env/test.env` holds only obviously fake, test-only values (FR-SEC-08) and a
local `_test` database.
"""

from __future__ import annotations

import os
from pathlib import Path

_ENV = Path(__file__).resolve().parents[1] / "env" / "test.env"
for _line in _ENV.read_text(encoding="utf8").splitlines():
    _line = _line.strip()
    if not _line or _line.startswith("#") or "=" not in _line:
        continue
    _key, _value = _line.split("=", 1)
    os.environ.setdefault(_key.strip(), _value.strip())

from .settings import *  # noqa: E402,F403
