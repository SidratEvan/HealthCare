"""Route mounting (port of `routes/index.ts`).

Base path `/api/v1`. Every response is `{ ok: true, data }` or
`{ ok: false, error: { code, message, details } }`. The routers are mounted
in the order the TypeScript mounts them, because the first route that matches
answers.
"""

from __future__ import annotations

import importlib

from ..core.pipeline import install_routes
from ..core.router import Router

#: The TypeScript's order (`buildApiRouter`). A router is listed once its
#: module is ported; `docs/django-migration/compatibility-matrix.md` tracks it.
API_ROUTERS: list[str] = [
    "discovery",
    "guest",
    "demo",
    "staff_auth",
    "patient_auth",
    "booking",
    "queue",
    "registration",
    "standby",
    "clinical",
    "consent",
    "lab",
    "payment",
    "webhooks",
    "mock_pay",
    "sync",
]

#: Mounted only where its condition holds (`buildApiRouter`).
_CONDITIONAL = {"mock_pay": lambda e: e.PAYMENT_PROVIDER == "mock"}


def build() -> tuple[Router, Router]:
    from ..core.demo_phones import install_demo_phone_rule
    from .health import health_routes

    # FR-DEM-08: a demonstration takes a person's phone only from its own list.
    install_demo_phone_rule()

    from ..core.env import env

    api = Router()
    for name in API_ROUTERS:
        condition = _CONDITIONAL.get(name)
        if condition is not None and not condition(env()):
            continue
        module = importlib.import_module(f"medlive.routes.{name}")
        api.use(module.routes)
    root = Router()
    root.use(health_routes)

    if env().NODE_ENV == "test":
        from .test_seam import routes as seam

        root.use(seam)
    install_routes(api, root)
    return api, root
