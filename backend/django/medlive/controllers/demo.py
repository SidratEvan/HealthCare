"""Demonstration picker controllers (port of `controllers/demo.controller.ts`; CLAUDE.md §4.1)."""

from __future__ import annotations

from ..core.http import ApiRequest, Reply, ok
from ..services import demo


def status(req: ApiRequest) -> Reply:
    return ok(demo.status())


def list_consoles(req: ApiRequest) -> Reply:
    return ok({"consoles": demo.list_consoles(), "national": demo.list_national_consoles()})


def mint_token(req: ApiRequest) -> Reply:
    body = req.body
    if "hospitalId" in body:
        return ok(demo.mint_principal(hospital_id=body["hospitalId"], role=body["role"]))
    return ok(demo.mint_national_principal(role=body["role"]))
