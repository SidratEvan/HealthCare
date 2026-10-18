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
API_ROUTERS: list[str] = []


def build() -> tuple[Router, Router]:
    from .health import health_routes

    api = Router()
    for name in API_ROUTERS:
        module = importlib.import_module(f"medlive.routes.{name}")
        api.use(module.routes)
    install_routes(api, health_routes)
    return api, health_routes
