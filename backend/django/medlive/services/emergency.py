"""Emergency: the search, the family's "I'm on my way", and the ER console
(port of `services/emergency.service.ts`; FR-ER-01..10, FR-PAT-16, S-B-07).

A case changes one step at a time under its row lock (`domain/emergency/cases.py`);
an action already taken is answered as a duplicate, never applied twice.
The search ranks hospitals by what they can treat, then by how fresh their
figures are, then by road time (`domain/emergency/ranking.py`), and says how
old every figure is.
"""

from __future__ import annotations

from typing import Any, Callable

from ..adapters.traveltime import travel_time
from ..core import db
from ..core.env import env
from ..core.errors import AppError, forbidden_scope, not_found, validation_failed
from ..core.jwt import verify_token
from ..core.schema import js_trim
from ..domain.emergency.cases import already_applied, can_act_on, is_open, next_token_label
from ..domain.emergency.freshness import freshness_of
from ..domain.emergency.ranking import (
    EMERGENCY_SEARCH_RADIUS_METRES,
    free_beds_for,
    need_for,
    rank_candidates,
    stamps_for_need,
)
from ..domain.time import js_round, now_iso, to_dhaka_date
from ..realtime import emit
from ..repositories import bed as bed_repo
from ..repositories import clinical as clinical_repo
from ..repositories import emergency as emergency_repo
from ..repositories import referral as referral_repo
from . import modules
from . import notification as notifications
from .links import emergency_case_token, emergency_case_url

MAX_ETA_MINUTES = 600


def _now() -> str:
    return now_iso()


def _today() -> str:
    return to_dhaka_date(_now())


# --- the search -----------------------------------------------------------


def _figures_for(beds: dict[str, Any] | None, capability_as_of: str | None) -> dict[str, Any]:
    return {
        "bedTotal": 0 if beds is None else beds["bedTotal"],
        "bedFree": 0 if beds is None else beds["bedFree"],
        "icuTotal": None if beds is None else beds["icuTotal"],
        "icuAsOf": None if beds is None else beds["icuAsOf"],
        "bedsAsOf": None if beds is None else beds["bedsAsOf"],
        "capabilityAsOf": capability_as_of,
        "byKind": [] if beds is None else beds["byKind"],
    }


def search(query: dict[str, Any]) -> dict[str, Any]:
    problem = query.get("problem")
    if query.get("capability") is None and query.get("bedKind") is None:
        need = need_for(problem)
    else:
        need = {"capability": query.get("capability"), "bedKind": query.get("bedKind")}
    capability = need["capability"]
    every_er = emergency_repo.er_hospitals()
    origin: dict[str, float] | None = None
    from_id = query.get("from")
    if from_id is not None:
        found = next((hospital for hospital in every_er if hospital["id"] == from_id), None)
        if found is None:
            raise not_found("hospital")
        if found["lat"] is not None and found["lng"] is not None:
            origin = {"lat": found["lat"], "lng": found["lng"]}
    elif query.get("lat") is not None and query.get("lng") is not None:
        origin = {"lat": query["lat"], "lng": query["lng"]}
    candidates = [hospital for hospital in every_er if hospital["id"] != from_id]
    geography = (
        None
        if origin is None
        else emergency_repo.nearby(
            lat=origin["lat"], lng=origin["lng"], capability=capability, radius_metres=EMERGENCY_SEARCH_RADIUS_METRES
        )
    )
    in_range = candidates if geography is None else [hospital for hospital in candidates if hospital["id"] in geography]
    ids = [hospital["id"] for hospital in in_range]
    capacity = bed_repo.public_capacity(ids)
    withheld = bed_repo.withholding_beds(ids)
    figures = emergency_repo.emergency_figures(ids)
    thresholds = emergency_repo.stale_thresholds(ids)
    capable = emergency_repo.capable_now(ids, capability) if geography is None and capability is not None else None
    at = _now()
    results: list[dict[str, Any]] = []
    for hospital in in_range:
        beds = capacity.get(hospital["id"])
        er = figures.get(hospital["id"])
        card_figures = _figures_for(beds, None if er is None else er["capabilityAsOf"])
        threshold = thresholds.get(hospital["id"], env().STALE_THRESHOLD_MINUTES)
        place = None if geography is None else geography.get(hospital["id"])
        if capability is None:
            has_capability = None
        elif place is not None:
            has_capability = place["hasCapability"]
        else:
            has_capability = capable is not None and hospital["id"] in capable
        results.append(
            {
                "hospitalId": hospital["id"],
                "nameBn": hospital["nameBn"],
                "nameEn": hospital["nameEn"],
                "addressBn": hospital["addressBn"],
                "addressEn": hospital["addressEn"],
                "lat": hospital["lat"],
                "lng": hospital["lng"],
                "emergencyPhone": hospital["emergencyPhone"],
                "distanceKm": None if place is None else js_round(place["distanceMetres"] / 100) / 10,
                "travelMinutes": None if place is None else travel_time().minutes_for(place["distanceMetres"], at),
                "hasCapability": has_capability,
                "erLoad": 0 if er is None else er["erActive"],
                "freeBeds": free_beds_for(need, card_figures),
                "bedsShared": hospital["id"] not in withheld,
                "bedKind": need["bedKind"],
                "icuTotal": None if beds is None else beds["icuTotal"],
                "icuFree": None if beds is None else beds["icuFree"],
                "icuAsOf": None if beds is None else beds["icuAsOf"],
                "freshness": freshness_of(stamps_for_need(need, card_figures), at, threshold),
                "staleAfterMinutes": threshold,
            }
        )
    ranked = rank_candidates([{**result, "stale": result["freshness"]["stale"]} for result in results])
    for result in ranked:
        del result["stale"]
    if from_id is not None:
        origin_kind = "hospital"
    elif origin is None:
        origin_kind = "none"
    else:
        origin_kind = "position"
    return {
        "problem": problem,
        "requiredCapability": capability,
        "bedKind": need["bedKind"],
        "origin": origin_kind,
        "radiusKm": EMERGENCY_SEARCH_RADIUS_METRES / 1000,
        "travelTime": travel_time().name,
        "results": ranked,
        "serverTs": at,
    }


# --- the family's side ----------------------------------------------------


def _required_case(case_id: str) -> dict[str, Any]:
    found = emergency_repo.find_case(case_id)
    if found is None:
        raise not_found("emergency case")
    return found


def _status_view(case_id: str) -> dict[str, Any]:
    status = emergency_repo.case_status(case_id)
    if status is None:
        raise not_found("emergency case")
    return {**status, "serverTs": _now()}


def _to_view(row: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in row.items() if key not in ("patientId", "createdAt")}


def _assert_scope(current: dict[str, Any], actor: dict[str, str]) -> None:
    if current["hospitalId"] != actor["hospitalId"]:
        raise forbidden_scope({"reason": "wrong_hospital"})


def _case_id_from(token: str) -> str:
    verified = verify_token(token, "emergency_case")
    if not verified.ok:
        if verified.reason == "expired":
            raise AppError("GUEST_LINK_EXPIRED")
        raise AppError("AUTH_TOKEN_INVALID", details={"reason": verified.reason})
    case_id = verified.claims.get("emergencyCaseId")
    if case_id is None:
        raise AppError("AUTH_TOKEN_INVALID", details={"reason": "no_case"})
    return case_id


def inbound(
    *,
    hospital_id: str,
    problem: str,
    lat: float | None,
    lng: float | None,
    phone: str | None,
    age_years: int | None,
    sex: str | None,
    idempotency_key: str | None,
) -> dict[str, Any]:
    modules.require_on(hospital_id, "emergency")
    if not emergency_repo.has_emergency_desk(hospital_id):
        raise validation_failed({"field": "hospitalId", "reason": "no_emergency_department"})
    eta_minutes: int | None = None
    if lat is not None and lng is not None:
        distance = emergency_repo.distance_to(hospital_id, lat=lat, lng=lng)
        minutes = None if distance is None else travel_time().minutes_for(distance, _now())
        eta_minutes = None if minutes is None else min(minutes, MAX_ETA_MINUTES)
    with db.transaction():
        filed: dict[str, Any] | None = None
        if idempotency_key is not None:
            emergency_repo.lock_idempotency_key(idempotency_key)
            existing = emergency_repo.find_by_idempotency_key(idempotency_key)
            if existing is not None:
                if existing["hospitalId"] != hospital_id:
                    raise validation_failed({"field": "Idempotency-Key", "reason": "reused_for_another_case"})
                filed = {"id": existing["id"], "duplicate": True}
        if filed is None:
            case_id = emergency_repo.insert_inbound(
                hospital_id=hospital_id,
                problem=problem,
                eta_minutes=eta_minutes,
                phone=phone,
                age_years=age_years,
                sex=sex,
                idempotency_key=idempotency_key,
            )
            filed = {"id": case_id, "duplicate": False}
    if not filed["duplicate"]:
        created = _required_case(filed["id"])
        emit.emergency_inbound(hospital_id, {"case": _to_view(created)}, _now())
    token = emergency_case_token(filed["id"])
    return {
        "case": _status_view(filed["id"]),
        "token": token,
        "trackUrl": emergency_case_url(token),
        "duplicate": filed["duplicate"],
    }


def track(token: str) -> dict[str, Any]:
    return _status_view(_case_id_from(token))


def cancel_by_family(token: str) -> dict[str, Any]:
    case_id = _case_id_from(token)

    def write(current: dict[str, Any]) -> dict[str, list[Any]]:
        emergency_repo.write_case(case_id, {"state": "cancelled", "closed": True})
        return notifications.NOTHING

    _act(case_id, "cancel", {}, None, None, write)
    return _status_view(case_id)


# --- the ER console -------------------------------------------------------


def board(hospital_id: str) -> dict[str, Any]:
    names = bed_repo.hospital_names(hospital_id)
    if names is None:
        raise not_found("hospital")
    cases = emergency_repo.open_cases(hospital_id)
    capabilities = emergency_repo.capabilities_of(hospital_id)
    published = bed_repo.public_capacity([hospital_id])
    bed_kinds = emergency_repo.bed_kinds_at(hospital_id)
    referrals = referral_repo.referrals_at(hospital_id, _today())
    stale_after_minutes = bed_repo.stale_threshold_minutes(hospital_id)
    return {
        "hospitalId": hospital_id,
        "hospitalNameBn": names["nameBn"],
        "hospitalNameEn": names["nameEn"],
        "cases": [_to_view(case) for case in cases],
        "load": sum(1 for entry in cases if is_open(entry["state"])),
        "capabilities": capabilities,
        "published": published.get(hospital_id),
        "bedKinds": bed_kinds,
        "referrals": referrals,
        "staleAfterMinutes": stale_after_minutes,
        "serverTs": _now(),
    }


def contact(case_id: str, actor: dict[str, str]) -> dict[str, Any]:
    current = _required_case(case_id)
    _assert_scope(current, actor)
    phone = emergency_repo.contact_of(case_id)
    if phone is not None:
        clinical_repo.record_record_view(
            staff_user_id=actor["staffUserId"],
            user_id=None,
            hospital_id=actor["hospitalId"],
            patient_id=current["patientId"],
            subject_table="emergency_cases",
            subject_id=case_id,
            meta={"surface": "S-B-07", "field": "contact_phone"},
        )
    return {"phone": phone, "serverTs": _now()}


def acknowledge(case_id: str, envelope: dict[str, Any], actor: dict[str, str]) -> dict[str, Any]:
    def write(current: dict[str, Any]) -> dict[str, list[Any]]:
        emergency_repo.write_case(case_id, {"state": "acknowledged", "acknowledged": True})
        return notifications.queue_emergency_answer(
            case_id=case_id, outcome="acknowledged", link=emergency_case_url(emergency_case_token(case_id))
        )

    return _act(case_id, "acknowledge", {}, actor, envelope.get("clientEventId"), write)


def command(case_id: str, body: dict[str, Any], envelope: dict[str, Any], actor: dict[str, str]) -> dict[str, Any]:
    action = body["action"]
    client_event_id = envelope.get("clientEventId")
    if action == "accept":

        def accept(current: dict[str, Any]) -> dict[str, list[Any]]:
            tokens = emergency_repo.token_context(current["hospitalId"], _today())
            emergency_repo.write_case(
                case_id,
                {
                    "state": "arrived",
                    "arrived": True,
                    "tokenLabel": next_token_label(tokens["arrivedToday"], tokens["openLabels"]),
                },
            )
            return notifications.NOTHING

        return _act(case_id, "accept", {}, actor, client_event_id, accept)
    if action == "decline":

        def decline(current: dict[str, Any]) -> dict[str, list[Any]]:
            emergency_repo.write_case(
                case_id, {"state": "declined", "closed": True, "declineReason": js_trim(body["reason"])}
            )
            return notifications.queue_emergency_answer(
                case_id=case_id, outcome="declined", link=emergency_case_url(emergency_case_token(case_id))
            )

        return _act(case_id, "decline", {"reason": body["reason"]}, actor, client_event_id, decline)
    if action == "triage":

        def triage(current: dict[str, Any]) -> dict[str, list[Any]]:
            emergency_repo.write_case(case_id, {"triage": body["triage"]})
            return notifications.NOTHING

        return _act(case_id, "triage", {"triage": body["triage"]}, actor, client_event_id, triage)
    if action == "handoff":
        if body["bedKind"] not in emergency_repo.bed_kinds_at(actor["hospitalId"]):
            raise validation_failed({"field": "bedKind", "reason": "not_at_this_hospital"})

        def handoff(current: dict[str, Any]) -> dict[str, list[Any]]:
            emergency_repo.write_case(case_id, {"admitBedKind": body["bedKind"]})
            return notifications.NOTHING

        return _act(case_id, "handoff", {"bedKind": body["bedKind"]}, actor, client_event_id, handoff)

    def discharge(current: dict[str, Any]) -> dict[str, list[Any]]:
        emergency_repo.write_case(case_id, {"state": "discharged", "closed": True})
        return notifications.NOTHING

    return _act(case_id, "discharge", {}, actor, client_event_id, discharge)


def walk_in(
    *,
    problem: str,
    triage: str | None,
    phone: str | None,
    age_years: int | None,
    sex: str | None,
    idempotency_key: str | None,
    actor: dict[str, str],
) -> dict[str, Any]:
    with db.transaction():
        filed: dict[str, Any] | None = None
        if idempotency_key is not None:
            emergency_repo.lock_idempotency_key(idempotency_key)
            existing = emergency_repo.find_by_idempotency_key(idempotency_key)
            if existing is not None:
                if existing["hospitalId"] != actor["hospitalId"]:
                    raise forbidden_scope({"reason": "wrong_hospital"})
                filed = {"id": existing["id"], "duplicate": True}
        if filed is None:
            tokens = emergency_repo.token_context(actor["hospitalId"], _today())
            case_id = emergency_repo.insert_walk_in(
                hospital_id=actor["hospitalId"],
                problem=problem,
                triage=triage,
                token_label=next_token_label(tokens["arrivedToday"], tokens["openLabels"]),
                phone=phone,
                age_years=age_years,
                sex=sex,
                idempotency_key=idempotency_key,
                created_by=actor["staffUserId"],
            )
            filed = {"id": case_id, "duplicate": False}
    return publish_case(filed["id"], filed["duplicate"], idempotency_key)


def confirm_capabilities(hospital_id: str, entries: list[dict[str, Any]], actor: dict[str, str]) -> dict[str, Any]:
    if hospital_id != actor["hospitalId"]:
        raise forbidden_scope({"reason": "wrong_hospital"})
    with db.transaction():
        declared = {row["kind"] for row in emergency_repo.capabilities_of(hospital_id)}
        undeclared = [entry for entry in entries if entry["kind"] not in declared]
        if undeclared:
            raise validation_failed(
                {"field": "capabilities", "reason": "not_declared_here", "kinds": [entry["kind"] for entry in undeclared]}
            )
        emergency_repo.confirm_capabilities(hospital_id=hospital_id, entries=entries, staff_user_id=actor["staffUserId"])
        capabilities = emergency_repo.capabilities_of(hospital_id)
    server_ts = _now()
    emit.capabilities_updated(hospital_id, {"capabilities": capabilities}, server_ts)
    return {"capabilities": capabilities, "serverTs": server_ts}


def publish_case(case_id: str, duplicate: bool = False, client_event_id: str | None = None) -> dict[str, Any]:
    current = _required_case(case_id)
    figures = emergency_repo.emergency_figures([current["hospitalId"]]).get(current["hospitalId"])
    load = 0 if figures is None else figures["erActive"]
    server_ts = _now()
    view = _to_view(current)
    if not duplicate:
        emit.emergency_updated(
            current["hospitalId"], {"case": view, "load": load, "clientEventId": client_event_id}, server_ts
        )
        if current["admitRequestedAt"] is not None:
            emit.emergency_handoff(current["hospitalId"], {"caseId": case_id, "state": current["state"]}, server_ts)
    return {"case": view, "load": load, "duplicate": duplicate, "serverTs": server_ts}


def _act(
    case_id: str,
    action: str,
    context: dict[str, Any],
    actor: dict[str, str] | None,
    client_event_id: str | None,
    write: Callable[[dict[str, Any]], dict[str, list[Any]]],
) -> dict[str, Any]:
    with db.transaction():
        current = emergency_repo.lock_case(case_id)
        if current is None:
            raise not_found("emergency case")
        if actor is not None:
            _assert_scope(current, actor)
        held = (
            referral_repo.open_referral_of(case_id) is not None if action in ("handoff", "discharge") else False
        )
        verdict = can_act_on(current, action, {**context, "openReferral": held})
        if not verdict["ok"]:
            if already_applied(current, action, context):
                outcome = {"batch": notifications.NOTHING, "duplicate": True}
            else:
                raise AppError(
                    "EMERGENCY_TRANSITION_INVALID",
                    message=verdict["detail"],
                    details={"guard": verdict["code"], "state": current["state"]},
                )
        else:
            outcome = {"batch": write(current), "duplicate": False}
    notifications.dispatch(outcome["batch"])
    return publish_case(case_id, outcome["duplicate"], client_event_id)
