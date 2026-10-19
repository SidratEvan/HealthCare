"""Referrals between ERs: send, see, answer, withdraw, arrive
(port of `services/referral.service.ts`; BACKEND.md §7.5, FR-EMG-07..09).

Every step locks the referral, decides with `can_act_on_referral` (the other
side's step is refused outright; an outcome already reached is a replay),
writes in one transaction with whatever it does to a case, and broadcasts to
both ERs only after commit. Arrival is the handover: the receiving ER opens a
case with a token, the sending ER's case closes as referred, together.

A referral names nobody, and nothing here reads a name or a number, so no
step writes the audit log (`DB-P7`).
"""

from __future__ import annotations

from typing import Any, Callable

from ..core import db
from ..core.errors import AppError, forbidden_scope, not_found, validation_failed
from ..core.schema import js_trim
from ..domain.emergency.cases import can_act_on, next_token_label
from ..domain.emergency.referrals import can_act_on_referral, can_refer, referral_already_applied, side_of
from ..domain.time import now_iso, to_dhaka_date
from ..realtime import emit
from ..repositories import emergency as emergency_repo
from ..repositories import referral as referral_repo
from . import emergency


def _now() -> str:
    return now_iso()


def _today() -> str:
    return to_dhaka_date(_now())


def _required_referral(referral_id: str) -> dict[str, Any]:
    found = referral_repo.find_referral(referral_id)
    if found is None:
        raise not_found("referral")
    return found


def send(
    *,
    emergency_case_id: str,
    to_hospital_id: str,
    required_capability: str | None,
    required_bed_kind: str | None,
    note: str | None,
    idempotency_key: str | None,
    actor: dict[str, str],
) -> dict[str, Any]:
    if to_hospital_id == actor["hospitalId"]:
        raise validation_failed({"field": "toHospitalId", "reason": "same_hospital"})
    if not emergency_repo.has_emergency_desk(to_hospital_id):
        raise validation_failed({"field": "toHospitalId", "reason": "no_emergency_department"})
    with db.transaction():
        filed: dict[str, Any] | None = None
        if idempotency_key is not None:
            referral_repo.lock_idempotency_key(idempotency_key)
            existing = referral_repo.find_by_idempotency_key(idempotency_key)
            if existing is not None:
                if existing["from"]["hospitalId"] != actor["hospitalId"]:
                    raise forbidden_scope({"reason": "wrong_hospital"})
                if existing["emergencyCaseId"] != emergency_case_id or existing["to"]["hospitalId"] != to_hospital_id:
                    raise validation_failed({"field": "Idempotency-Key", "reason": "reused_for_another_referral"})
                filed = {"id": existing["id"], "duplicate": True}
        if filed is None:
            current = emergency_repo.lock_case(emergency_case_id)
            if current is None:
                raise not_found("emergency case")
            if current["hospitalId"] != actor["hospitalId"]:
                raise forbidden_scope({"reason": "wrong_hospital"})
            open_referral = referral_repo.open_referral_of(current["id"])
            verdict = can_refer(current, open_referral is not None)
            if not verdict["ok"]:
                raise AppError(
                    "REFERRAL_TRANSITION_INVALID",
                    message=verdict["detail"],
                    details={"guard": verdict["code"], "state": current["state"]},
                )
            referral_id = referral_repo.insert_referral(
                from_hospital_id=actor["hospitalId"],
                to_hospital_id=to_hospital_id,
                emergency_case_id=current["id"],
                required_capability=required_capability,
                required_bed_kind=required_bed_kind,
                summary={
                    "problem": current["problem"],
                    "triage": current["triage"],
                    "ageYears": current["ageYears"],
                    "sex": current["sex"],
                    "note": note,
                },
                idempotency_key=idempotency_key,
                created_by=actor["staffUserId"],
            )
            filed = {"id": referral_id, "duplicate": False}
    referral = _required_referral(filed["id"])
    server_ts = _now()
    if not filed["duplicate"]:
        emit.referral_incoming(referral["to"]["hospitalId"], {"referral": referral}, server_ts)
        emit.referral_updated([referral["from"]["hospitalId"]], {"referral": referral}, server_ts)
    return {"referral": referral, "duplicate": filed["duplicate"], "serverTs": server_ts}


Write = Callable[[dict[str, Any]], "list[str] | None"]


def _act(referral_id: str, action: str, context: dict[str, Any], actor: dict[str, str], write: Write) -> dict[str, Any]:
    with db.transaction():
        current = referral_repo.lock_referral(referral_id)
        if current is None:
            raise not_found("referral")
        side = side_of(current, actor["hospitalId"])
        if side is None:
            raise forbidden_scope({"reason": "wrong_hospital"})
        verdict = can_act_on_referral(current, action, side, context)
        if not verdict["ok"]:
            if verdict["code"] == "WRONG_SIDE":
                raise forbidden_scope({"reason": "wrong_side"})
            if referral_already_applied(current, action):
                outcome: dict[str, Any] = {"cases": None, "duplicate": True}
            else:
                raise AppError(
                    "REFERRAL_TRANSITION_INVALID",
                    message=verdict["detail"],
                    details={"guard": verdict["code"], "state": current["state"]},
                )
        else:
            outcome = {"cases": write(current), "duplicate": False}
    referral = _required_referral(referral_id)
    server_ts = _now()
    if not outcome["duplicate"]:
        # The cases first: a console that hears the referral arrive and then
        # looks for the person on its triage list should find them there.
        for case_id in outcome["cases"] or []:
            emergency.publish_case(case_id)
        emit.referral_updated(
            [referral["from"]["hospitalId"], referral["to"]["hospitalId"]], {"referral": referral}, server_ts
        )
    return {"referral": referral, "duplicate": outcome["duplicate"], "serverTs": server_ts}


def seen(referral_id: str, actor: dict[str, str]) -> dict[str, Any]:
    def write(current: dict[str, Any]) -> None:
        referral_repo.write_referral(referral_id, {"state": "seen", "seen": True})

    return _act(referral_id, "seen", {}, actor, write)


def accept(referral_id: str, actor: dict[str, str]) -> dict[str, Any]:
    def write(current: dict[str, Any]) -> None:
        referral_repo.write_referral(referral_id, {"state": "accepted", "seen": True, "respondedBy": actor["staffUserId"]})

    return _act(referral_id, "accept", {}, actor, write)


def decline(referral_id: str, reason: str, actor: dict[str, str]) -> dict[str, Any]:
    def write(current: dict[str, Any]) -> None:
        referral_repo.write_referral(
            referral_id,
            {
                "state": "declined",
                "seen": True,
                "respondedBy": actor["staffUserId"],
                "declineReason": js_trim(reason),
                "closed": True,
            },
        )

    return _act(referral_id, "decline", {"reason": reason}, actor, write)


def cancel(referral_id: str, actor: dict[str, str]) -> dict[str, Any]:
    def write(current: dict[str, Any]) -> None:
        referral_repo.write_referral(referral_id, {"state": "cancelled", "closed": True})

    return _act(referral_id, "cancel", {}, actor, write)


def arrive(referral_id: str, actor: dict[str, str]) -> dict[str, Any]:
    def write(current: dict[str, Any]) -> list[str]:
        sender_case_id = current["emergencyCaseId"]
        sender_case = None if sender_case_id is None else emergency_repo.lock_case(sender_case_id)
        if sender_case is not None and can_act_on(sender_case, "refer")["ok"]:
            emergency_repo.write_case(sender_case["id"], {"state": "referred", "closed": True})
        tokens = emergency_repo.token_context(actor["hospitalId"], _today())
        summary = current["summary"]
        arrived_case_id = emergency_repo.insert_walk_in(
            hospital_id=actor["hospitalId"],
            problem=summary["problem"],
            triage=summary["triage"],
            token_label=next_token_label(tokens["arrivedToday"], tokens["openLabels"]),
            phone=None,
            age_years=summary["ageYears"],
            sex=summary["sex"],
            idempotency_key=None,
            created_by=actor["staffUserId"],
        )
        referral_repo.write_referral(referral_id, {"state": "arrived", "arrivedCaseId": arrived_case_id, "closed": True})
        return [arrived_case_id, *([] if sender_case is None else [sender_case["id"]])]

    return _act(referral_id, "arrive", {}, actor, write)
