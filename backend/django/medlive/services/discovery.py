"""Finding a hospital, a doctor, a chamber (port of `services/discovery.service.ts`; FR-PAT-16..19, S-A-07)."""

from __future__ import annotations

from typing import Any

from ..core.errors import AppError, not_found
from ..domain.brand import not_shared_of, png_size, read_brand_theme
from ..domain.queue.eta import projected_end
from ..domain.search import order_for_need, parse_need, read_search
from ..domain.time import js_round, now_iso, parse_ms, to_dhaka_date
from ..repositories import bed as bed_repo
from ..repositories import discovery as discovery_repo
from . import modules
from . import queue as queue_service

BOOKABLE_DAYS = 7
SEARCH_DOCTORS = 20


def scope_info(code: str) -> dict[str, Any]:
    row = discovery_repo.find_scope(code)
    if row is None:
        raise not_found("hospital")
    return {
        "code": row["code"],
        "hospitalId": row["id"],
        "nameBn": row["nameBn"],
        "nameEn": row["nameEn"],
        "theme": read_brand_theme(row["brand"]),
        "descriptionBn": row["descriptionBn"],
        "descriptionEn": row["descriptionEn"],
        "logoVersion": row["logoVersion"],
        "logoImage": _logo_image_of(row["logoType"], row["logoHeadHex"]),
        "modulesOff": row["modulesOff"],
        "notShared": not_shared_of(row["unpublished"], row["modulesOff"]),
    }


def _logo_image_of(kind: str | None, head_hex: str | None) -> dict[str, Any] | None:
    if kind != "image/png" or head_hex is None:
        return None
    size = png_size(head_hex)
    return None if size is None else {"type": kind, **size}


def logo(hospital_id: str) -> dict[str, Any] | None:
    return discovery_repo.find_logo(hospital_id)


def _scoped_hospital_id(scope: str | None) -> str | None:
    return None if scope is None else scope_info(scope)["hospitalId"]


def search_hospitals(query: dict[str, Any]) -> dict[str, Any]:
    cards = discovery_repo.list_hospitals(
        hospital_id=_scoped_hospital_id(query.get("scope")),
        specialty=query.get("specialty"),
        district=query.get("district"),
        q=query.get("q"),
        lat=query.get("lat"),
        lng=query.get("lng"),
        limit=query.get("limit", 50),
    )
    bed_kind = query.get("bedKind")
    with_kind = None if bed_kind is None else bed_repo.hospitals_with_kind(bed_kind)
    shown = cards if with_kind is None else [card for card in cards if card["id"] in with_kind]
    capacity = bed_repo.public_capacity([card["id"] for card in shown])
    return {"items": [{**card, "beds": capacity.get(card["id"])} for card in shown], "asOf": now_iso()}


def search(query: dict[str, Any]) -> dict[str, Any]:
    """One box for everything (FR-PAT-16): a need read from the text, names matched too."""
    limit = query.get("limit", 30)
    reading = read_search(query.get("q"))
    chosen = None
    if query.get("need") is not None:
        chosen = parse_need(query["need"])
        if chosen is None:
            raise AppError("VALIDATION_FAILED", details={"need": "unknown_need"})
    need = chosen if chosen is not None else reading["need"]
    narrowing = None if chosen is None else reading["text"]
    hospital_id = _scoped_hospital_id(query.get("scope"))
    position = {"lat": query.get("lat"), "lng": query.get("lng"), "hospital_id": hospital_id}

    by_need = (
        []
        if need is None
        else discovery_repo.list_hospitals(
            specialty=need["code"] if need["kind"] == "specialty" else None,
            capability=need["capability"] if need["kind"] == "capability" else None,
            q=narrowing,
            limit=limit,
            **position,
        )
    )
    with_kind = bed_repo.hospitals_with_kind(need["bedKind"]) if need is not None and need["kind"] == "bed" else None
    meeting = by_need if with_kind is None else [card for card in by_need if card["id"] in with_kind]
    by_name = discovery_repo.list_hospitals(q=reading["text"], limit=limit, **position) if chosen is None else []
    seen = {card["id"] for card in meeting}
    named = by_name if need is None else [card for card in by_name if card["id"] not in seen]
    cards = [*meeting, *(named if need is None or reading["text"] is not None else [])][:limit]
    capacity = bed_repo.public_capacity([card["id"] for card in cards])
    listings = [{**card, "beds": capacity.get(card["id"])} for card in cards]

    doctors_by_name = (
        [] if reading["text"] is None else discovery_repo.list_doctors(q=reading["text"], hospital_id=hospital_id, limit=SEARCH_DOCTORS)
    )
    doctors_by_specialty = (
        discovery_repo.list_doctors(specialty=need["code"], q=narrowing, hospital_id=hospital_id, limit=SEARCH_DOCTORS)
        if need is not None and need["kind"] == "specialty"
        else []
    )
    doctor_ids = {doctor["id"] for doctor in doctors_by_name}
    doctors = []
    for doctor in [*doctors_by_name, *(d for d in doctors_by_specialty if d["id"] not in doctor_ids)]:
        if hospital_id is not None:
            doctor = {**doctor, "chambers": [c for c in doctor["chambers"] if c["hospitalId"] == hospital_id]}
        if doctor["chambers"]:
            doctors.append(doctor)
    return {
        "need": need,
        "text": reading["text"],
        "hospitals": order_for_need(listings, need),
        "doctors": doctors[:SEARCH_DOCTORS],
        "asOf": now_iso(),
    }


def hospital_detail(hospital_id: str) -> dict[str, Any]:
    hospital = discovery_repo.find_hospital(hospital_id)
    if hospital is None:
        raise not_found("hospital")
    departments = discovery_repo.list_departments(hospital_id)
    capacity = bed_repo.public_capacity([hospital_id])
    return {"hospital": hospital, "departments": departments, "beds": capacity.get(hospital_id)}


def search_doctors(query: dict[str, Any]) -> list[dict[str, Any]]:
    scoped = _scoped_hospital_id(query.get("scope"))
    return discovery_repo.list_doctors(
        specialty=query.get("specialty"),
        hospital_id=scoped if scoped is not None else query.get("hospitalId"),
        q=query.get("q"),
        limit=query.get("limit", 50),
    )


def doctor_detail(doctor_id: str) -> dict[str, Any]:
    doctor = next((d for d in discovery_repo.list_doctors(limit=1000) if d["id"] == doctor_id), None)
    if doctor is None:
        raise not_found("doctor")
    return {
        "doctor": doctor,
        "sessions": discovery_repo.list_bookable_sessions(doctor_id=doctor_id, from_date=_today(), days=BOOKABLE_DAYS),
    }


def sessions_for(query: dict[str, Any]) -> list[dict[str, Any]]:
    return discovery_repo.list_bookable_sessions(
        doctor_id=query.get("doctorId"), hospital_id=query.get("hospitalId"), from_date=_today(), days=BOOKABLE_DAYS
    )


def doctors_at(hospital_id: str, specialty: str | None = None) -> dict[str, Any]:
    if discovery_repo.find_hospital(hospital_id) is None:
        raise not_found("hospital")
    return {"items": discovery_repo.doctors_at_hospital(hospital_id, specialty), "asOf": now_iso()}


def availability(session_id: str) -> dict[str, Any]:
    session = queue_service.require_session(session_id)
    modules.require_on(session["hospitalId"], "queue")
    state = queue_service.get_state(session_id)
    now = now_iso()
    taken = sum(1 for entry in state["entries"] if entry["status"] != "cancelled")
    capacity = session["capacity"]
    shared = discovery_repo.publishes(session["hospitalId"], "serials")
    return {
        "sessionId": session_id,
        "capacity": capacity,
        "taken": taken if shared else None,
        "remaining": None if capacity is None or not shared else max(0, capacity - taken),
        "full": capacity is not None and taken >= capacity,
        "nextSerial": queue_service.next_serial(session_id),
        "expectedWaitMinutes": _wait_for_next_serial(state, now),
        "asOf": now,
    }


def _wait_for_next_serial(state: dict[str, Any], now: str) -> int | None:
    end = projected_end(state, now)
    if end is None:
        return None
    return max(0, js_round((parse_ms(end) - parse_ms(now)) / 60_000))


def _today() -> str:
    return to_dhaka_date(now_iso())
