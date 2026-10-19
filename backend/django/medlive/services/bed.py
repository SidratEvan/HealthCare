"""The ward board (port of `services/bed.service.ts`; FR-BED-01..09, S-B-06).

Every change locks the beds it touches, releases any hold that lapsed
underneath it, checks the move against the board's rules
(`domain/beds.py`), writes an event and the bed's new row in one
transaction, and then tells the ward, the public capacity mirror and the
family waiting on a request. A replayed `clientEventId` is answered with the
beds as they are now, never applied twice.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from ..core import db
from ..core.errors import AppError, forbidden_scope, not_found, validation_failed
from ..core.jwt import verify_token
from ..core.schema import js_trim
from ..core.scope import SYSTEM, db_scope
from ..domain.beds import can_apply, can_forecast_discharge, can_receive_transfer, hold_lapsed, outcome_of
from ..domain.emergency.cases import can_act_on
from ..domain.time import from_datetime, now_iso, now_ms, parse_ms, to_dhaka_date, utc_now
from ..realtime import emit
from ..repositories import bed as bed_repo
from ..repositories import clinical as clinical_repo
from ..repositories import emergency as emergency_repo
from ..repositories import guest as guest_repo
from ..repositories import referral as referral_repo
from . import modules
from . import notification as notifications
from .links import bed_request_token, bed_request_url


def _now() -> str:
    return now_iso()


def _today() -> str:
    return to_dhaka_date(_now())


def _datetime_of(iso: str | None) -> datetime | None:
    return None if iso is None else datetime.fromtimestamp(parse_ms(iso) / 1000, tz=timezone.utc)


def _transition_invalid(code: str, detail: str) -> AppError:
    return AppError("BED_TRANSITION_INVALID", message=detail, details={"guard": code})


def _conflict(reason: str, detail: str, extra: dict[str, Any] | None = None) -> AppError:
    return AppError("BED_CONFLICT", message=detail, details={"reason": reason, **(extra or {})})


def _cleared(state: str) -> dict[str, Any]:
    return {"state": state, "admissionId": None, "expectedDischargeDate": None, "reservedUntil": None, "oosReason": None}


def _required(bed: dict[str, Any] | None) -> dict[str, Any]:
    if bed is None:
        raise not_found("bed")
    return bed


def _first(locked: list[dict[str, Any]]) -> dict[str, Any] | None:
    return locked[0] if locked else None


_VIEW_KEYS = (
    "id",
    "wardId",
    "label",
    "kind",
    "state",
    "nightlyPoisha",
    "lastCleanedAt",
    "stateChangedAt",
    "expectedDischargeDate",
    "reservedUntil",
    "oosReason",
    "admissionId",
    "heldForRequestId",
    "version",
)


def _to_view(bed: dict[str, Any]) -> dict[str, Any]:
    return {key: bed[key] for key in _VIEW_KEYS}


def _guard(bed: dict[str, Any], action: str, context: dict[str, Any] | None = None) -> None:
    verdict = can_apply(bed, action, _now(), context or {})
    if not verdict["ok"]:
        raise _transition_invalid(verdict["code"], verdict["detail"])


def _assert_scope(bed: dict[str, Any], actor: dict[str, str]) -> None:
    if bed["hospitalId"] != actor["hospitalId"]:
        raise forbidden_scope({"reason": "wrong_hospital"})


def _published_for(hospital_id: str) -> dict[str, Any] | None:
    return bed_repo.public_capacity([hospital_id]).get(hospital_id)


def _current_beds(hospital_id: str, bed_ids: list[str]) -> list[dict[str, Any]]:
    if not bed_ids:
        return []
    wanted = set(bed_ids)
    return [_to_view(bed) for bed in bed_repo.list_beds(hospital_id) if bed["id"] in wanted]


def _request_view(request_id: str) -> dict[str, Any]:
    status = bed_repo.request_status(request_id)
    if status is None:
        raise not_found("bed request")
    lapsed = status["state"] == "held" and status["holdExpiresAt"] is not None and parse_ms(status["holdExpiresAt"]) <= now_ms()
    return {**status, "state": "expired" if lapsed else status["state"], "serverTs": _now()}


# --- board, panel, pending ------------------------------------------------


def board(hospital_id: str) -> dict[str, Any]:
    _release_lapsed_holds(hospital_id)
    names = bed_repo.hospital_names(hospital_id)
    wards = bed_repo.list_wards(hospital_id)
    beds = bed_repo.list_beds(hospital_id)
    published = _published_for(hospital_id)
    stale_after_minutes = bed_repo.stale_threshold_minutes(hospital_id)
    if names is None:
        raise not_found("hospital")
    server_ts = _now()
    return {
        "hospitalId": hospital_id,
        "hospitalNameBn": names["nameBn"],
        "hospitalNameEn": names["nameEn"],
        "wards": wards,
        "beds": [_to_view(bed) for bed in beds],
        "published": published,
        "staleAfterMinutes": stale_after_minutes,
        "today": to_dhaka_date(server_ts),
        "serverTs": server_ts,
    }


def panel(bed_id: str, actor: dict[str, str]) -> dict[str, Any]:
    bed = bed_repo.find_bed(bed_id)
    if bed is None:
        raise not_found("bed")
    _assert_scope(bed, actor)
    occupant = bed_repo.occupant_of(bed_id)
    if occupant is not None:
        clinical_repo.record_record_view(
            staff_user_id=actor["staffUserId"],
            user_id=None,
            hospital_id=actor["hospitalId"],
            patient_id=occupant["patientId"],
            subject_table="admissions",
            subject_id=occupant["admissionId"],
            meta={"surface": "S-B-06", "bedId": bed_id},
        )
    return {"bed": _to_view(bed), "occupant": occupant}


def pending(hospital_id: str, actor: dict[str, str]) -> dict[str, Any]:
    _release_lapsed_holds(hospital_id)
    requests = bed_repo.pending_requests(hospital_id)
    cases = emergency_repo.handoffs(hospital_id)
    handoffs = [
        {
            "caseId": entry["id"],
            "tokenLabel": entry["tokenLabel"],
            "problem": entry["problem"],
            "triage": entry["triage"],
            "ageYears": entry["ageYears"],
            "sex": entry["sex"],
            "bedKind": entry["admitBedKind"],
            "requestedAt": entry["admitRequestedAt"],
        }
        for entry in cases
        if entry["admitBedKind"] is not None and entry["admitRequestedAt"] is not None
    ]
    for request in requests:
        clinical_repo.record_record_view(
            staff_user_id=actor["staffUserId"],
            user_id=None,
            hospital_id=hospital_id,
            patient_id=request["patientId"],
            subject_table="bed_requests",
            subject_id=request["id"],
            meta={"surface": "LIST-B06-PENDING"},
        )
    return {"requests": requests, "handoffs": handoffs, "serverTs": _now()}


# --- the one way a change is made -----------------------------------------


Body = Callable[[list[dict[str, Any]]], dict[str, Any]]


def _run(bed_ids: list[str], envelope: dict[str, Any], actor: dict[str, str], body: Body) -> dict[str, Any]:
    client_event_id = envelope.get("clientEventId")
    if client_event_id is not None:
        replayed = bed_repo.find_replay(client_event_id)
        if replayed is not None:
            if replayed["hospitalId"] != actor["hospitalId"]:
                raise forbidden_scope({"reason": "wrong_hospital"})
            return {
                "beds": _current_beds(replayed["hospitalId"], bed_ids if bed_ids else [replayed["bedId"]]),
                "published": _published_for(replayed["hospitalId"]),
                "duplicate": True,
                "serverTs": replayed["serverTs"],
            }
    with db.transaction():
        unique = list(dict.fromkeys(bed_ids))
        locked = bed_repo.lock_beds(unique) if unique else []
        if len(locked) != len(unique):
            raise not_found("bed")
        for bed in locked:
            _assert_scope(bed, actor)
        lapsed_requests: list[str] = []
        if any(hold_lapsed(bed, _now()) for bed in locked):
            for bed in [candidate for candidate in locked if hold_lapsed(candidate, _now())]:
                request = _release_one(bed)
                if request is not None:
                    lapsed_requests.append(request)
            locked = bed_repo.lock_beds(unique)
        result = body(locked)
        changed = {**result, "requests": [*result["requests"], *lapsed_requests]}
    if changed.get("batch") is not None:
        notifications.dispatch(changed["batch"])
    published = _publish(actor["hospitalId"], changed["bedIds"], changed["requests"], client_event_id)
    cases = changed.get("cases") or []
    if cases:
        from . import emergency as emergency_service

        for case_id in cases:
            emergency_service.publish_case(case_id)
    return published


def _record(
    bed: dict[str, Any],
    action: str,
    actor: dict[str, str],
    envelope: dict[str, Any],
    *,
    admission_id: str | None = None,
    bed_request_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    outcome = outcome_of(action)
    bed_repo.append_event(
        {
            "hospitalId": bed["hospitalId"],
            "bedId": bed["id"],
            "type": outcome["type"],
            "from": bed["state"],
            "to": outcome["to"],
            "admissionId": admission_id,
            "bedRequestId": bed_request_id,
            "actorStaffId": actor["staffUserId"],
            "payload": payload or {},
            "clientEventId": envelope.get("clientEventId"),
            "clientTs": envelope.get("clientTs"),
        }
    )


def _release_one(bed: dict[str, Any]) -> str | None:
    bed_repo.append_event(
        {
            "hospitalId": bed["hospitalId"],
            "bedId": bed["id"],
            "type": "RELEASE",
            "from": "reserved",
            "to": "free",
            "admissionId": None,
            "bedRequestId": bed["heldForRequestId"],
            "actorStaffId": None,
            "payload": {"reason": "hold_lapsed", "reservedUntil": bed["reservedUntil"]},
            "clientEventId": None,
            "clientTs": None,
        }
    )
    bed_repo.write_bed(bed["id"], _cleared("free"))
    if bed["heldForRequestId"] is None:
        return None
    request = bed_repo.find_request(bed["heldForRequestId"])
    bed_repo.answer_request(
        request_id=bed["heldForRequestId"],
        state="expired",
        bed_id=bed["id"],
        hold_expires_at=None if request is None else _datetime_of(request["holdExpiresAt"]),
        responded_by=None,
    )
    return bed["heldForRequestId"]


def _release_lapsed_holds(hospital_id: str) -> None:
    with db.transaction():
        lapsed = bed_repo.lock_lapsed_holds(hospital_id)
        requests: list[str] = []
        for bed in lapsed:
            request = _release_one(bed)
            if request is not None:
                requests.append(request)
    if lapsed:
        _publish(hospital_id, [bed["id"] for bed in lapsed], requests)


def _publish(
    hospital_id: str, bed_ids: list[str], request_ids: list[str], client_event_id: str | None = None
) -> dict[str, Any]:
    beds = _current_beds(hospital_id, bed_ids)
    published = _published_for(hospital_id)
    server_ts = _now()
    if beds:
        emit.bed_updated(hospital_id, {"beds": beds, "clientEventId": client_event_id}, server_ts)
    if published is not None:
        emit.capacity_updated(hospital_id, published, server_ts)
    for request_id in dict.fromkeys(request_ids):
        request = bed_repo.find_request(request_id)
        if request is not None:
            emit.bed_request_updated(hospital_id, {"requestId": request_id, "state": request["state"]}, server_ts)
    return {"beds": beds, "published": published, "duplicate": False, "serverTs": server_ts}


def _simple(action: str, to: str, input: dict[str, Any], actor: dict[str, str]) -> dict[str, Any]:
    def body(locked: list[dict[str, Any]]) -> dict[str, Any]:
        bed = _required(_first(locked))
        _guard(bed, action)
        _record(bed, action, actor, input)
        bed_repo.write_bed(bed["id"], _cleared(to))
        return {"bedIds": [bed["id"]], "requests": []}

    return _run([input["bedId"]], input, actor, body)


# --- admitting ------------------------------------------------------------


def _patient_at_desk(who: dict[str, Any]) -> str:
    guest_id = guest_repo.find_or_create_identity(phone=who["phone"], display_name=who["name"])
    return guest_repo.find_or_create_patient(
        guest_id=guest_id, full_name=who["name"], age_years=who["ageYears"], sex=who["sex"], phone=who["phone"]
    )


def _handed_off_case(case_id: str, actor: dict[str, str]) -> dict[str, Any]:
    found = emergency_repo.lock_case(case_id)
    if found is None:
        raise not_found("emergency case")
    if found["hospitalId"] != actor["hospitalId"]:
        raise forbidden_scope({"reason": "wrong_hospital"})
    verdict = can_act_on(found, "admit", {"openReferral": referral_repo.open_referral_of(case_id) is not None})
    if not verdict["ok"]:
        raise AppError(
            "EMERGENCY_TRANSITION_INVALID",
            message=verdict["detail"],
            details={"guard": verdict["code"], "state": found["state"]},
        )
    return found


def _pending_request(request_id: str, actor: dict[str, str]) -> dict[str, Any]:
    request = bed_repo.lock_request(request_id)
    if request is None:
        raise not_found("bed request")
    if request["hospitalId"] != actor["hospitalId"]:
        raise forbidden_scope({"reason": "wrong_hospital"})
    if request["state"] not in ("requested", "held"):
        raise _conflict(
            "request_not_pending", "That request is no longer waiting for an answer.", {"state": request["state"]}
        )
    return request


def _admit_into(
    *,
    bed: dict[str, Any],
    patient_id: str,
    request: dict[str, Any] | None,
    emergency_case_id: str | None,
    expected_discharge_date: str | None,
    actor: dict[str, str],
    envelope: dict[str, Any],
) -> None:
    source = "er" if emergency_case_id is not None else "opd" if request is None else "app_request"
    _guard(bed, "admit", {"bedRequestId": None if request is None else request["id"]})
    if request is not None and request["state"] == "held" and request["bedId"] != bed["id"]:
        raise _transition_invalid("HELD_ELSEWHERE", "This request is holding a different bed.")
    if expected_discharge_date is not None and expected_discharge_date < _today():
        raise _transition_invalid("DISCHARGE_DATE_PAST", "An expected discharge cannot be in the past.")
    patient = bed_repo.lock_patient_for_admit(patient_id)
    if not patient["exists"]:
        raise not_found("patient")
    if patient["openAdmissionBedId"] is not None:
        raise _conflict(
            "patient_already_admitted", "This patient is already in a bed.", {"bedId": patient["openAdmissionBedId"]}
        )
    admission_id = bed_repo.insert_admission(
        patient_id=patient_id,
        hospital_id=bed["hospitalId"],
        bed_id=bed["id"],
        source=source,
        bed_request_id=None if request is None else request["id"],
        emergency_case_id=emergency_case_id,
        expected_discharge_date=expected_discharge_date,
        created_by=actor["staffUserId"],
    )
    _record(
        bed,
        "admit",
        actor,
        envelope,
        admission_id=admission_id,
        bed_request_id=None if request is None else request["id"],
        payload={"source": source},
    )
    bed_repo.write_bed(
        bed["id"], {**_cleared("occupied"), "admissionId": admission_id, "expectedDischargeDate": expected_discharge_date}
    )
    if request is not None:
        bed_repo.answer_request(
            request_id=request["id"],
            state="confirmed",
            bed_id=bed["id"],
            hold_expires_at=_datetime_of(request["holdExpiresAt"]),
            responded_by=actor["staffUserId"],
        )


def admit(input: dict[str, Any], actor: dict[str, str]) -> dict[str, Any]:
    who = input["who"]

    def body(locked: list[dict[str, Any]]) -> dict[str, Any]:
        bed = _required(_first(locked))
        request = _pending_request(who["bedRequestId"], actor) if who["kind"] == "request" else None
        emergency_case = _handed_off_case(who["emergencyCaseId"], actor) if who["kind"] == "emergency" else None
        patient_id = (request["patientId"] if request is not None else "") if who["kind"] == "request" else _patient_at_desk(who)
        _admit_into(
            bed=bed,
            patient_id=patient_id,
            request=request,
            emergency_case_id=None if emergency_case is None else emergency_case["id"],
            expected_discharge_date=input["expectedDischargeDate"],
            actor=actor,
            envelope=input,
        )
        if emergency_case is not None:
            emergency_repo.write_case(emergency_case["id"], {"state": "admitted", "closed": True, "patientId": patient_id})
        return {
            "bedIds": [bed["id"]],
            "requests": [] if request is None else [request["id"]],
            "cases": [] if emergency_case is None else [emergency_case["id"]],
        }

    return _run([input["bedId"]], input, actor, body)


# --- the other moves ------------------------------------------------------


def discharge(input: dict[str, Any], actor: dict[str, str]) -> dict[str, Any]:
    def body(locked: list[dict[str, Any]]) -> dict[str, Any]:
        bed = _required(_first(locked))
        _guard(bed, "discharge")
        admission_id = bed["admissionId"]
        if admission_id is None:
            raise RuntimeError(f"Occupied bed {bed['id']} names no admission.")
        bed_repo.close_admission(admission_id)
        _record(bed, "discharge", actor, input, admission_id=admission_id)
        bed_repo.write_bed(bed["id"], _cleared("cleaning"))
        return {"bedIds": [bed["id"]], "requests": []}

    return _run([input["bedId"]], input, actor, body)


def transfer(input: dict[str, Any], actor: dict[str, str]) -> dict[str, Any]:
    def body(locked: list[dict[str, Any]]) -> dict[str, Any]:
        source = next((bed for bed in locked if bed["id"] == input["bedId"]), None)
        target = next((bed for bed in locked if bed["id"] == input["toBedId"]), None)
        if source is None or target is None:
            raise not_found("bed")
        _guard(source, "transfer")
        verdict = can_receive_transfer(source, target, _now())
        if not verdict["ok"]:
            raise _transition_invalid(verdict["code"], verdict["detail"])
        admission_id = source["admissionId"]
        if admission_id is None:
            raise RuntimeError(f"Occupied bed {source['id']} names no admission.")
        bed_repo.move_admission(admission_id, target["id"])
        _record(
            source,
            "transfer",
            actor,
            input,
            admission_id=admission_id,
            payload={"toBedId": target["id"], "toLabel": target["label"]},
        )
        bed_repo.append_event(
            {
                "hospitalId": target["hospitalId"],
                "bedId": target["id"],
                "type": "TRANSFER",
                "from": target["state"],
                "to": "occupied",
                "admissionId": admission_id,
                "bedRequestId": None,
                "actorStaffId": actor["staffUserId"],
                "payload": {"fromBedId": source["id"], "fromLabel": source["label"]},
                "clientEventId": None,
                "clientTs": input.get("clientTs"),
            }
        )
        bed_repo.write_bed(source["id"], _cleared("cleaning"))
        bed_repo.write_bed(
            target["id"],
            {**_cleared("occupied"), "admissionId": admission_id, "expectedDischargeDate": source["expectedDischargeDate"]},
        )
        return {"bedIds": [source["id"], target["id"]], "requests": []}

    return _run([input["bedId"], input["toBedId"]], input, actor, body)


def _hold_until(minutes: int) -> datetime:
    """`new Date(Date.now() + minutes * 60_000)`: to the millisecond, as Node writes it."""
    at = utc_now() + timedelta(minutes=minutes)
    return at.replace(microsecond=at.microsecond // 1000 * 1000)


def _iso_ms(at: datetime) -> str:
    return from_datetime(at)


def reserve(input: dict[str, Any], actor: dict[str, str]) -> dict[str, Any]:
    def body(locked: list[dict[str, Any]]) -> dict[str, Any]:
        bed = _required(_first(locked))
        _guard(bed, "reserve", {"holdMinutes": input["minutes"]})
        until = _hold_until(input["minutes"])
        _record(bed, "reserve", actor, input, payload={"minutes": input["minutes"], "reservedUntil": _iso_ms(until)})
        bed_repo.write_bed(bed["id"], {**_cleared("reserved"), "reservedUntil": until})
        return {"bedIds": [bed["id"]], "requests": []}

    return _run([input["bedId"]], input, actor, body)


def release(input: dict[str, Any], actor: dict[str, str]) -> dict[str, Any]:
    def body(locked: list[dict[str, Any]]) -> dict[str, Any]:
        bed = _required(_first(locked))
        _guard(bed, "release")
        if bed["heldForRequestId"] is not None:
            raise _transition_invalid(
                "HELD_FOR_REQUEST", "This bed is held for a request. Admit or decline the request instead."
            )
        _record(bed, "release", actor, input)
        bed_repo.write_bed(bed["id"], _cleared("free"))
        return {"bedIds": [bed["id"]], "requests": []}

    return _run([input["bedId"]], input, actor, body)


def clean_start(input: dict[str, Any], actor: dict[str, str]) -> dict[str, Any]:
    return _simple("clean_start", "cleaning", input, actor)


def clean_done(input: dict[str, Any], actor: dict[str, str]) -> dict[str, Any]:
    def body(locked: list[dict[str, Any]]) -> dict[str, Any]:
        bed = _required(_first(locked))
        _guard(bed, "clean_done")
        _record(bed, "clean_done", actor, input)
        bed_repo.write_bed(bed["id"], {**_cleared("free"), "cleaned": True})
        return {"bedIds": [bed["id"]], "requests": []}

    return _run([input["bedId"]], input, actor, body)


def out_of_service(input: dict[str, Any], actor: dict[str, str]) -> dict[str, Any]:
    def body(locked: list[dict[str, Any]]) -> dict[str, Any]:
        bed = _required(_first(locked))
        _guard(bed, "oos", {"reason": input["reason"]})
        reason = js_trim(input["reason"])
        _record(bed, "oos", actor, input, payload={"reason": reason})
        bed_repo.write_bed(bed["id"], {**_cleared("out_of_service"), "oosReason": reason})
        return {"bedIds": [bed["id"]], "requests": []}

    return _run([input["bedId"]], input, actor, body)


def restore(input: dict[str, Any], actor: dict[str, str]) -> dict[str, Any]:
    return _simple("restore", "free", input, actor)


def forecast_discharge(input: dict[str, Any], actor: dict[str, str]) -> dict[str, Any]:
    def body(locked: list[dict[str, Any]]) -> dict[str, Any]:
        bed = _required(_first(locked))
        verdict = can_forecast_discharge(bed, input["date"], _today())
        if not verdict["ok"]:
            raise _transition_invalid(verdict["code"], verdict["detail"])
        admission_id = bed["admissionId"]
        if admission_id is None:
            raise RuntimeError(f"Occupied bed {bed['id']} names no admission.")
        bed_repo.write_discharge_forecast(bed_id=bed["id"], admission_id=admission_id, date=input["date"])
        return {"bedIds": [bed["id"]], "requests": []}

    return _run([input["bedId"]], {**input, "clientEventId": None}, actor, body)


# --- requests from families -----------------------------------------------


def create_request(
    *,
    hospital_id: str,
    bed_kind: str,
    patient: dict[str, Any],
    note: str | None,
    expected_arrival_at: str | None,
    idempotency_key: str | None,
) -> dict[str, Any]:
    if not bed_repo.hospital_exists(hospital_id):
        raise not_found("hospital")
    modules.require_on(hospital_id, "beds")
    if hospital_id not in bed_repo.hospitals_with_kind(bed_kind):
        raise validation_failed({"field": "bedKind", "reason": "not_offered_here"})
    with db_scope(SYSTEM):
        with db.transaction():
            guest_id = guest_repo.find_or_create_identity(phone=patient["phone"], display_name=patient["name"])
            patient_id = guest_repo.find_or_create_patient(
                guest_id=guest_id,
                full_name=patient["name"],
                age_years=patient["ageYears"],
                sex=patient["sex"],
                phone=patient["phone"],
            )
            existing = bed_repo.find_existing_request(
                idempotency_key=idempotency_key, patient_id=patient_id, hospital_id=hospital_id
            )
            if existing is not None:
                filed = {"request": existing, "guestId": guest_id, "duplicate": True}
            else:
                request = bed_repo.insert_request(
                    hospital_id=hospital_id,
                    patient_id=patient_id,
                    bed_kind=bed_kind,
                    guest_id=guest_id,
                    note=note,
                    expected_arrival_at=expected_arrival_at,
                    idempotency_key=idempotency_key,
                )
                filed = {"request": request, "guestId": guest_id, "duplicate": False}
    token = bed_request_token(filed["request"]["id"], filed["guestId"])
    server_ts = _now()
    if not filed["duplicate"]:
        emit.bed_request_updated(
            hospital_id, {"requestId": filed["request"]["id"], "state": filed["request"]["state"]}, server_ts
        )
    return {
        "request": _request_view(filed["request"]["id"]),
        "token": token,
        "trackUrl": bed_request_url(token),
        "duplicate": filed["duplicate"],
    }


def track_request(token: str) -> dict[str, Any]:
    verified = verify_token(token, "bed_request")
    if not verified.ok:
        if verified.reason == "expired":
            raise AppError("GUEST_LINK_EXPIRED")
        raise AppError("AUTH_TOKEN_INVALID", details={"reason": verified.reason})
    request_id = verified.claims.get("bedRequestId")
    if request_id is None:
        raise AppError("AUTH_TOKEN_INVALID", details={"reason": "no_request"})
    return _request_view(request_id)


def respond(request_id: str, input: dict[str, Any], actor: dict[str, str]) -> dict[str, Any]:
    request = bed_repo.find_request(request_id)
    if request is None:
        raise not_found("bed request")
    if request["hospitalId"] != actor["hospitalId"]:
        raise forbidden_scope({"reason": "wrong_hospital"})
    action = input["action"]
    if action == "decline":
        bed_ids = [] if request["bedId"] is None else [request["bedId"]]
    else:
        bed_ids = [input.get("bedId") or request["bedId"] or ""]
    if "" in bed_ids:
        raise validation_failed({"field": "bedId", "reason": "required_without_a_hold"})

    def body(locked: list[dict[str, Any]]) -> dict[str, Any]:
        current = _pending_request(request_id, actor)
        subject = current["requestedByGuestId"] or current["patientId"]
        link = bed_request_url(bed_request_token(current["id"], subject))
        if action == "hold":
            bed = _required(_first(locked))
            if current["state"] != "requested":
                raise _conflict("request_already_answered", "That request has already been answered.")
            if bed["kind"] != current["bedKind"]:
                raise _transition_invalid(
                    "KIND_MISMATCH", f"The family asked for a {current['bedKind']} bed; hold one of those."
                )
            _guard(bed, "reserve", {"holdMinutes": input["minutes"]})
            until = _hold_until(input["minutes"])
            _record(
                bed,
                "reserve",
                actor,
                input,
                bed_request_id=current["id"],
                payload={"minutes": input["minutes"], "reservedUntil": _iso_ms(until)},
            )
            bed_repo.write_bed(bed["id"], {**_cleared("reserved"), "reservedUntil": until})
            bed_repo.answer_request(
                request_id=current["id"],
                state="held",
                bed_id=bed["id"],
                hold_expires_at=until,
                responded_by=actor["staffUserId"],
            )
            return {
                "bedIds": [bed["id"]],
                "requests": [current["id"]],
                "batch": notifications.queue_bed_request_answer(
                    request_id=current["id"],
                    outcome="held",
                    hold_expires_at=_iso_ms(until),
                    link=link,
                    subject=subject,
                ),
            }
        if action == "confirm":
            bed = _required(_first(locked))
            _admit_into(
                bed=bed,
                patient_id=current["patientId"],
                request=current,
                emergency_case_id=None,
                expected_discharge_date=None,
                actor=actor,
                envelope=input,
            )
            return {"bedIds": [bed["id"]], "requests": [current["id"]]}
        held = next((bed for bed in locked if bed["heldForRequestId"] == current["id"]), None)
        if held is not None:
            _record(held, "release", actor, input, bed_request_id=current["id"], payload={"reason": "request_declined"})
            bed_repo.write_bed(held["id"], _cleared("free"))
        bed_repo.answer_request(
            request_id=current["id"],
            state="declined",
            bed_id=current["bedId"],
            hold_expires_at=_datetime_of(current["holdExpiresAt"]),
            responded_by=actor["staffUserId"],
        )
        return {
            "bedIds": [] if held is None else [held["id"]],
            "requests": [current["id"]],
            "batch": notifications.queue_bed_request_answer(
                request_id=current["id"], outcome="declined", hold_expires_at=None, link=link, subject=subject
            ),
        }

    result = _run(bed_ids, input, actor, body)
    return {**result, "request": _request_view(request_id)}
