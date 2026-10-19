"""A hospital workspace's state, and how ready it is (port of `org/lifecycle.ts`;
PRD.md §14c, FR-ONB-02..04, FR-ONB-06).

    setup --request--> ready_for_review --approve--> active --> closed
      ^                     | send back               |  ^
      +---------------------+               suspend   v  | reinstate
                                                   suspended --> closed

Going live is two acts by two people: the hospital asks, the platform
approves. Readiness is counted when asked, never stored.
"""

from __future__ import annotations

import math
import re
from typing import Any

ORG_ACTIONS = {
    "request_review": "hospital",
    "approve": "platform",
    "send_back": "platform",
    "suspend": "platform",
    "reinstate": "platform",
    "close": "platform",
}

_TRANSITIONS: dict[str, dict[str, str]] = {
    "request_review": {"setup": "ready_for_review"},
    "approve": {"ready_for_review": "active"},
    "send_back": {"ready_for_review": "setup"},
    "suspend": {"active": "suspended"},
    "reinstate": {"suspended": "active"},
    "close": {"setup": "closed", "ready_for_review": "closed", "active": "closed", "suspended": "closed"},
}


def next_lifecycle(current: str, action: str) -> str | None:
    return _TRANSITIONS[action].get(current)


def platform_actions(current: str) -> list[str]:
    return [action for action, who in ORG_ACTIONS.items() if who == "platform" and next_lifecycle(current, action) is not None]


def action_needs_note(action: str) -> bool:
    return action in ("send_back", "suspend", "close")


def is_public_lifecycle(lifecycle: str) -> bool:
    return lifecycle == "active"


CHECKLIST_ITEMS = (
    "departments",
    "doctors",
    "schedules",
    "staff",
    "contact",
    "location",
    "emergency_services",
    "beds",
    "verified_doctors",
)


def setup_checklist(counts: dict[str, Any]) -> list[dict[str, Any]]:
    required = {"required": True, "advised": False}
    advised = {"required": False, "advised": True}
    optional = {"required": False, "advised": False}

    def item(key: str, count: int, kind: dict[str, bool]) -> dict[str, Any]:
        return {"key": key, "count": count, "done": count > 0, **kind}

    items = [
        item("departments", counts["departments"], required),
        item("doctors", counts["doctors"], required),
        item("schedules", counts["schedules"], required),
        item("staff", counts["staff"], required),
        item("contact", counts["contact"], advised),
        item("location", counts["location"], advised),
    ]
    # Named only where there is an emergency desk to say it of.
    if counts["capabilities"] is not None:
        items.append(item("emergency_services", counts["capabilities"], advised))
    items.append(item("beds", counts["beds"], optional))
    items.append(item("verified_doctors", counts["verifiedDoctors"], optional))
    return items


def identity_editable(lifecycle: str) -> bool:
    return lifecycle == "setup"


def missing_for_review(counts: dict[str, Any]) -> list[str]:
    return [item["key"] for item in setup_checklist(counts) if item["required"] and not item["done"]]


def missing_for_approval(counts: dict[str, Any]) -> list[str]:
    missing = missing_for_review(counts)
    if counts["verifiedDoctors"] == 0:
        missing.append("verified_doctors")
    return missing


# --- a workspace's health (port of `org/health.ts`; FR-SUP-06) --------------
#
# A flag is for what is wrong beyond argument: a message that failed or is
# still waiting, a figure a live hospital shares that nobody ever confirmed.
# A stale figure is ranked, not flagged; late sync is shown, not flagged.

HEALTH_FIGURES = ("beds", "capabilities")
WORKSPACE_ATTENTIONS = ("unconfirmed_figures", "messages")
MESSAGE_WAITING_MINUTES = 5
LATE_ACTION_SECONDS = 60
HEALTH_WINDOW_DAYS = 7


def figure_health(stamp: dict[str, Any], now: str, threshold_minutes: float) -> dict[str, Any]:
    from .emergency.freshness import freshness_of

    return {"figure": stamp["figure"], "shared": stamp["shared"], **freshness_of([stamp["asOf"]], now, threshold_minutes)}


def workspace_attention(*, live: bool, figures: list[dict[str, Any]], messages: dict[str, int]) -> list[str]:
    attention: list[str] = []
    if live and any(figure["shared"] and figure["asOf"] is None for figure in figures):
        attention.append("unconfirmed_figures")
    if messages["failed"] > 0 or messages["waiting"] > 0:
        attention.append("messages")
    return attention


def stalest_figure(*, live: bool, figures: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not live:
        return None
    stalest: dict[str, Any] | None = None
    for figure in figures:
        if not figure["shared"] or not figure["stale"] or figure["ageMinutes"] is None:
            continue
        if stalest is None or figure["ageMinutes"] > stalest["ageMinutes"]:
            stalest = {"figure": figure["figure"], "ageMinutes": figure["ageMinutes"]}
    return stalest


def workspace_health(
    *,
    live: bool,
    stamps: list[dict[str, Any]],
    messages: dict[str, int],
    sync: dict[str, Any],
    now: str,
    threshold_minutes: float,
) -> dict[str, Any]:
    figures = [figure_health(stamp, now, threshold_minutes) for stamp in stamps]
    return {
        "figures": figures,
        "messages": messages,
        "sync": sync,
        "attention": workspace_attention(live=live, figures=figures, messages=messages),
        "stalest": stalest_figure(live=live, figures=figures),
    }


def delivery_percent(messages: dict[str, int]) -> int | None:
    attempted = messages["sent"] + messages["failed"]
    if attempted == 0:
        return None
    # As JavaScript computes it, in floating point: 29 of 100 is 28.999... and floors to 28.
    return math.floor((messages["sent"] / attempted) * 100)


# --- a hospital applies by itself (port of `org/application.ts`; FR-ONB-09) --
#
# The code is made from the English name: its first word that says something
# (`Teesta General Hospital` -> `TEESTA`), and a number after it when taken.

APPLICATION_PASSWORD_MIN = 10

_GENERIC = {
    "THE", "AND", "OF", "HOSPITAL", "HOSPITALS", "CLINIC", "CLINICS", "DIAGNOSTIC", "DIAGNOSTICS",
    "CENTRE", "CENTER", "MEDICAL", "COLLEGE", "GENERAL", "SPECIALISED", "SPECIALIZED", "HEALTH",
    "HEALTHCARE", "CARE", "LTD", "LIMITED", "PVT", "PRIVATE", "DEMO",
}  # fmt: skip

_CODE_MAX = 16
_STEM_MAX = 12
_BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯"


def _bare(text: str) -> str:
    from ..core.schema import js_trim

    digits = "".join(str(_BENGALI_DIGITS.index(c)) if c in _BENGALI_DIGITS else c for c in js_trim(text))
    return re.sub(r"[\s().-]", "", digits)


def _full_number(digits: str) -> str:
    if digits.startswith("+880"):
        return digits
    if digits.startswith("880"):
        return f"+{digits}"
    if digits.startswith("0"):
        return f"+88{digits}"
    return digits


def mobile_from(text: str) -> str | None:
    full = _full_number(_bare(text))
    return full if re.fullmatch(r"\+8801[3-9][0-9]{8}", full) else None


def facility_phone_from(text: str) -> str | None:
    full = _full_number(_bare(text))
    return full if re.fullmatch(r"\+880[0-9]{8,11}", full) else None


def code_stem(name_en: str) -> str:
    words = [word for word in re.split(r"[^A-Z0-9]+", name_en.upper()) if len(word) >= 2]
    telling = next((word for word in words if word not in _GENERIC), words[0] if words else "HOSPITAL")
    return telling[:_STEM_MAX]


def code_for(name_en: str, taken: set[str]) -> str | None:
    stem = code_stem(name_en)
    if stem not in taken:
        return stem
    for n in range(2, 100):
        candidate = f"{stem}-{n}"
        if len(candidate) <= _CODE_MAX and candidate not in taken:
            return candidate
    return None
