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
