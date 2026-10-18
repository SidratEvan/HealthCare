"""A chamber's hour-long arrival windows (port of `sessions/arrivalWindows.ts`; FR-QUE-* arrival windows)."""

from __future__ import annotations

import math
from typing import Any

from .time import from_epoch_ms, parse_ms

HOUR_MS = 60 * 60 * 1000
MAX_WINDOWS = 12


def arrival_windows(planned_start: str, planned_end: str) -> list[dict[str, str]]:
    start = parse_ms(planned_start)
    end = parse_ms(planned_end)
    if not math.isfinite(start) or not math.isfinite(end) or end <= start:
        return []
    windows: list[dict[str, str]] = []
    at = start
    while at < end and len(windows) < MAX_WINDOWS:
        windows.append({"start": from_epoch_ms(at), "end": from_epoch_ms(min(at + HOUR_MS, end))})
        at += HOUR_MS
    return windows


def arrival_window_at(planned_start: str, planned_end: str, chosen_start: str) -> dict[str, Any] | None:
    chosen = parse_ms(chosen_start)
    if not math.isfinite(chosen):
        return None
    for window in arrival_windows(planned_start, planned_end):
        if parse_ms(window["start"]) == chosen:
            return window
    return None
