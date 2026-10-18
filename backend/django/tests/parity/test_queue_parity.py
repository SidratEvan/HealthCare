"""The Python queue engine against the TypeScript one, case for case.

`generate_queue_vectors.ts` drives the TypeScript reducer, guards, ETA, rate,
replay and patients' view over 80 seeded logs (half legal, half chaos) and
records every input with every output. Here the same inputs go through the
Python port and every output must be identical. CLAUDE.md §7 says the reducer
exists once; with two languages it exists twice, and this file is what keeps
them one.
"""

from __future__ import annotations

import json
import math
from typing import Any

import pytest

from medlive.domain.queue import eta, rate, rules
from medlive.domain.queue.patient_view import patient_view_of
from medlive.domain.queue.quote import suggested_quote
from medlive.domain.queue.reducer import reduce
from medlive.domain.queue.replay import apply_batch, continue_replay, needs_full_rebuild, replay
from medlive.domain.queue.state import check_invariants, empty_state, project, queue_counts

from .conftest import load_vectors

VECTORS = load_vectors("queue")
SETTINGS = VECTORS["settings"]


def ticket(booking_id: str) -> str:
    return "t-" + booking_id[::-1]


def same(actual: Any, expected: Any, where: str) -> None:
    """Deep equality with JSON's number rules (1 == 1.0) and NaN as null."""
    a = json.loads(json.dumps(actual, allow_nan=True).replace("NaN", "null"))
    assert a == expected, where


def observe(state: dict[str, Any], nows: list[str]) -> dict[str, Any]:
    etas = [eta.compute_etas(state, now) for now in nows]
    told = {e["bookingId"]: _iso_at(i * 240_000) for i, e in enumerate(state["entries"])}
    return {
        "state": state,
        "project": project(state),
        "counts": queue_counts(state),
        "invariants": check_invariants(state),
        "spread": rate.rate_spread_seconds(state["rate"]),
        "etas": etas,
        "etasWithPrevious": eta.compute_etas(state, nows[0], told),
        "earlierThanTold": [e["bookingId"] for e in eta.earlier_than_told(state, etas[0], told, state["plan"]["plannedStart"])],
        "outstandingDelay": [eta.outstanding_delay_minutes(state, now) for now in nows],
        "projectedEnd": [eta.projected_end(state, now) for now in nows],
        "twoAway": eta.two_away_bookings(state),
        "patientView": patient_view_of(state, etas[0], ticket),
        "guards": guards_at(state, nows[1]),
    }


BASE_MS = 1_789_642_800_000  # 2026-09-17T11:00:00.000Z


def _iso_at(offset_ms: int) -> str:
    from medlive.domain.time import from_epoch_ms

    return from_epoch_ms(BASE_MS + offset_ms)


def guards_at(state: dict[str, Any], now: str) -> dict[str, Any]:
    return {
        "canDeclareDoctorArrived": rules.can_declare_doctor_arrived(state),
        "canDeclareDelay": [rules.can_declare_delay(state, m) for m in (0, 1, 30, 480, 481, 2.5)],
        "canPause": rules.can_pause(state),
        "canResume": rules.can_resume(state),
        "canCallNext": rules.can_call_next(state),
        "nextToCall": (rules.next_to_call(state) or {}).get("bookingId"),
        "canEndSession": rules.can_end_session(state),
        "unseenAtEnd": rules.unseen_at_end(state),
        "hasCapacity": rules.has_capacity(state),
        "canAddWalkin": [
            rules.can_add_walkin(state, "end", None),
            rules.can_add_walkin(state, "index", None),
            rules.can_add_walkin(state, "index", " x "),
        ],
        "lapsedOffers": [o["offerId"] for o in rules.lapsed_offers(state, now)],
        "canReplayOffline": [
            rules.can_replay_offline("PATIENT_CALLED", ["doctor"]),
            rules.can_replay_offline("PATIENT_NO_SHOW", ["doctor"]),
            rules.can_replay_offline("ACTION_UNDONE", ["receptionist"]),
        ],
        "graceWindowMinutes": rules.grace_window_minutes(state, SETTINGS),
        "perBooking": [
            {
                "bookingId": entry["bookingId"],
                "canMarkDone": rules.can_mark_done(state, entry["bookingId"]),
                "canMarkNoShow": rules.can_mark_no_show(state, entry["bookingId"], SETTINGS, now),
                "graceRemaining": rules.grace_remaining(state, entry["bookingId"], SETTINGS, now),
                "canCheckIn": [rules.can_check_in(state, entry["bookingId"], q) for q in (0, 25, 480, 481, 1.5)],
                "canReinstate": rules.can_reinstate(state, entry["bookingId"]),
                "canDeclareLate": rules.can_declare_late(state, entry["bookingId"]),
                "lateReinsertIndex": rules.late_reinsert_index(state, entry["bookingId"], 3),
                "canReorder": [
                    rules.can_reorder(state, entry["bookingId"], "  "),
                    rules.can_reorder(state, entry["bookingId"], "elderly"),
                ],
                "canOfferFreedSlot": rules.can_offer_freed_slot(state, entry["bookingId"]),
                "suggestedQuote": suggested_quote(state, entry["bookingId"], now),
            }
            for entry in state["entries"]
        ],
        "canAcceptSlot": [rules.can_accept_slot(state, o["offerId"], now) for o in state["offers"]],
    }


@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda c: c["name"])
def test_every_step_matches(case: dict[str, Any]) -> None:
    state = empty_state(case["seed"])
    expected_steps = {step["index"]: step for step in case["steps"]}
    for index, event in enumerate(case["events"]):
        state = reduce(state, event)
        if index in expected_steps:
            expected = {k: v for k, v in expected_steps[index].items() if k != "index"}
            same(observe(state, case["nows"]), expected, f"{case['name']} after event {index}")


@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda c: c["name"])
def test_replay_matches(case: dict[str, Any]) -> None:
    same(replay(case["seed"], case["events"]), case["replayed"], "replay")
    same(replay(case["seed"], case["shuffled"]), case["replayedShuffled"], "replay of the shuffled log")
    half = len(case["events"]) // 2
    first = replay(case["seed"], case["events"][:half])
    same(continue_replay(first, case["events"][half:]), case["continued"], "continued replay")
    assert needs_full_rebuild(first, case["events"][half:]) == case["needsFullRebuild"]
    same(apply_batch(first, case["events"][half:]), case["batch"], "batch outcome")


def test_rate_matches() -> None:
    for item in VECTORS["rateCases"]:
        seconds = item["seconds"] if item["seconds"] is not None else math.nan
        observed = rate.observe_consult({"seedSeconds": 480, "currentSeconds": 480, "samples": [300, 600]}, seconds)
        same(observed, item["observed"], f"observe_consult({item['seconds']})")
    for item in VECTORS["measured"]:
        assert rate.measured_consult_seconds(item["calledAt"], item["now"]) == item["seconds"], item
