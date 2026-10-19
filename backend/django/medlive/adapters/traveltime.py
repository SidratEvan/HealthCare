"""How long the road takes (port of `adapters/traveltime.ts`; FR-ER-03).

`TRAVEL_TIME_MODE=static` is the demo's and the pilot's: a straight-line
distance stretched by a road factor, at a speed that depends on Dhaka's hour.
Anything else answers "unknown" rather than guess.
"""

from __future__ import annotations

import math
from typing import Any

from ..core.env import env
from ..domain.time import to_dhaka_clock

ROAD_FACTOR = 1.4
SPEED_BANDS = (
    {"from": 7, "to": 10, "kmh": 12},
    {"from": 10, "to": 16, "kmh": 18},
    {"from": 16, "to": 21, "kmh": 12},
)
NIGHT_KMH = 28


class StaticTravelTime:
    name = "static"

    def minutes_for(self, distance_metres: float, at: str) -> int:
        hour = to_dhaka_clock(at)["hour"]
        kmh = next((band["kmh"] for band in SPEED_BANDS if band["from"] <= hour < band["to"]), NIGHT_KMH)
        road_km = (distance_metres / 1000) * ROAD_FACTOR
        return max(1, math.ceil((road_km / kmh) * 60))


class UnconfiguredTravelTime:
    name = "unconfigured"

    def minutes_for(self, distance_metres: float, at: str) -> None:
        return None


_current: list[Any] = [None]


def travel_time() -> Any:
    if _current[0] is None:
        _current[0] = StaticTravelTime() if env().TRAVEL_TIME_MODE == "static" else UnconfiguredTravelTime()
    return _current[0]


def set_travel_time_adapter(adapter: Any) -> None:
    _current[0] = adapter


def reset_travel_time_adapter() -> None:
    _current[0] = None
