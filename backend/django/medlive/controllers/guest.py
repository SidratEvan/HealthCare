"""Tracking-link controllers (port of `controllers/guest.controller.ts`; FR-GST-05)."""

from __future__ import annotations

from ..core.http import ApiRequest, Reply, ok
from ..services import guest


def open_tracking_link(req: ApiRequest) -> Reply:
    return ok(guest.open_tracking_link(req.params["token"]))


def report_url(req: ApiRequest) -> Reply:
    return ok({"url": guest.report_url(req.params["token"], req.params["reportId"])})
