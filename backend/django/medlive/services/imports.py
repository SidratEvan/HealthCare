"""Importing a hospital's own data (port of `services/import.service.ts`; S-B-14, PRD.md §14b, FR-IMP-01..11).

Four moves, each audited (FR-IMP-08):
- check reads every row, writes only the batch and its rows, and answers
  with the preview (FR-IMP-05);
- commit is an administrator's approval, all or nothing (FR-IMP-06); a batch
  with an error cannot be committed;
- undo removes what a batch added and puts back what it changed, unless
  something has since been built on one of its rows, and then names those
  rows and changes nothing (FR-IMP-07);
- discard drops a checked batch.

Every row keeps the hospital's own identifier (`external_refs`), so the same
row imported again updates what it made (FR-IMP-04). Template example rows
are skipped. A staff email already here is skipped. Beds arrive out of
service. Imported patients belong to the hospital (FR-IMP-10).
"""

from __future__ import annotations

import functools
import hashlib
from typing import Any

from ..core import db
from ..core.demo_phones import demo_phone_admitted
from ..core.errors import AppError, not_found
from ..domain.imports.csv import parse_csv
from ..domain.imports.sets import (
    IMPORT_COLUMNS,
    column_index,
    latin_digits,
    missing_columns,
    read_row,
    ref_kind_of,
    template_csv,
)
from ..domain.imports.warnings import NO_WARNINGS, import_warnings
from ..domain.jsfmt import locale_compare
from ..domain.phone import normalise_bd_mobile
from ..domain.schemas.settings import BED_UNCONFIRMED_REASON
from ..domain.time import now_iso, to_dhaka_date
from ..core.schema import js_trim
from ..repositories import hospital_settings as settings_repo
from ..repositories import imports as repo
from ..repositories import staff_auth as staff_auth_repo
from .queue import broadcast_roster
from .session_materialise import materialise

MAX_IMPORT_ROWS = 20_000

#: An account created by an import holds no password until an administrator issues one.
NO_PASSWORD = "!disabled:imported"


def _refused(reason: str, extra: dict[str, Any] | None = None) -> AppError:
    return AppError("IMPORT_FILE", details={"reason": reason, **(extra or {})})


def _wrong_state(reason: str) -> AppError:
    return AppError("IMPORT_STATE", details={"reason": reason})


def _fail(field: str, code: str) -> dict[str, Any]:
    return {"action": "error", "errors": [{"field": field, "code": code}], "targetKind": None, "targetId": None}


def _is_example(record: dict[str, Any]) -> bool:
    return record["ref"].upper().startswith("EXAMPLE")


def _key_of(record: dict[str, Any]) -> str:
    return f"{ref_kind_of(record)}:{record['ref']}"


def node_utf8(text: str) -> bytes:
    """`Buffer.from(text, 'utf8')`: a lone surrogate becomes U+FFFD, as Node writes it."""
    return text.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "replace").encode("utf-8")


def sha256_of_text(text: str) -> str:
    """`createHash('sha256').update(text, 'utf8')`."""
    return hashlib.sha256(node_utf8(text)).hexdigest()


def _today() -> str:
    return to_dhaka_date(now_iso())


# --- reading ----------------------------------------------------------------


def template(set_kind: str) -> str:
    return template_csv(set_kind)


def list_batches(hospital_id: str) -> list[dict[str, Any]]:
    return repo.batches_of(hospital_id)


def view(hospital_id: str, batch_id: str) -> dict[str, Any]:
    batch = repo.batch_of(hospital_id, batch_id)
    if batch is None:
        raise not_found("import")
    rows = repo.rows_of(batch_id)
    return {
        **batch,
        "errors": [
            {"rowNumber": row["rowNumber"], "field": error["field"], "code": error["code"]}
            for row in rows
            for error in (row["errors"] or [])
        ],
        # Only while there is still something to decide.
        "warnings": import_warnings(batch["setKind"], rows) if batch["state"] == "checked" else NO_WARNINGS,
    }


# --- check (FR-IMP-05) --------------------------------------------------------


def check(actor: dict[str, Any], *, set_kind: str, file_name: str, csv: str, file_sha256: str | None = None) -> dict[str, Any]:
    table = parse_csv(csv)
    if table in ("empty", "unterminated_quote"):
        raise _refused(table)  # type: ignore[arg-type]
    assert isinstance(table, dict)
    missing = missing_columns(set_kind, table["header"])
    if missing:
        raise _refused("missing_columns", {"columns": missing})
    if len(table["rows"]) > MAX_IMPORT_ROWS:
        raise _refused("too_many_rows", {"max": MAX_IMPORT_ROWS})

    index = column_index(set_kind, table["header"])
    refs = repo.refs_of(actor["hospitalId"])

    # First pass: every row read on its own, so a doctor may name a department further down.
    read: list[dict[str, Any]] = []
    for row in table["rows"]:
        cells = row["cells"]
        raw: dict[str, str] = {}
        for column in IMPORT_COLUMNS[set_kind]:
            at = index.get(column, -1)
            value = "" if at < 0 or at >= len(cells) else js_trim(cells[at])
            if value != "":
                raw[column] = value
        read.append({"rowNumber": row["rowNumber"], "raw": raw, "result": read_row(set_kind, cells, index)})

    # FR-DEM-08: a demonstration takes no real phone number. Every row's mobile,
    # read or not, is held to the list before the batch is written; only the
    # template's own example row is passed over.
    refused_rows: list[int] = []
    for entry in read:
        if entry["result"]["ok"] and _is_example(entry["result"]["record"]):
            continue
        typed = entry["raw"].get("mobile")
        phone = None if typed is None else normalise_bd_mobile(latin_digits(typed))
        if phone is not None and not demo_phone_admitted(phone):
            refused_rows.append(entry["rowNumber"])
    if refused_rows:
        raise AppError("DEMO_PHONE_NOT_ALLOWED", details={"rows": refused_rows[:50], "count": len(refused_rows)})

    in_file = {
        _key_of(entry["result"]["record"])
        for entry in read
        if entry["result"]["ok"] and not _is_example(entry["result"]["record"])
    }

    # Second pass: what each row would do.
    seen: set[str] = set()
    rows: list[dict[str, Any]] = []
    for entry in read:
        result = entry["result"]
        if not result["ok"]:
            decision = {"action": "error", "errors": result["errors"], "targetKind": None, "targetId": None}
        elif _is_example(result["record"]):
            decision = {"action": "skip", "errors": [], "targetKind": None, "targetId": None}
        elif _key_of(result["record"]) in seen:
            decision = _fail("ref", "duplicate_in_file")
        else:
            seen.add(_key_of(result["record"]))
            decision = _decide(actor["hospitalId"], result["record"], refs, in_file)
        rows.append({"rowNumber": entry["rowNumber"], "raw": entry["raw"], **decision})

    counts = {"add": 0, "update": 0, "skip": 0, "error": 0}
    for row in rows:
        counts[row["action"]] += 1
    sha256 = file_sha256 or sha256_of_text(csv)
    # How many warnings the administrator was shown, for the record: counts only.
    warned = import_warnings(set_kind, rows)

    with db.transaction():
        batch_id = repo.create_batch(
            hospital_id=actor["hospitalId"],
            set_kind=set_kind,
            file_name=file_name,
            file_sha256=sha256,
            counts=counts,
            created_by=actor["staffId"],
            rows=rows,
        )
        repo.audit(
            actor_staff_id=actor["staffId"],
            hospital_id=actor["hospitalId"],
            batch_id=batch_id,
            event="checked",
            meta={
                "set": set_kind,
                "fileName": file_name,
                "fileSha256": sha256,
                "counts": counts,
                "warnings": {
                    "samePerson": warned["samePersonTotal"],
                    "mixedFormats": [mixed["field"] for mixed in warned["mixedFormats"]],
                },
            },
            ip=actor["ip"],
            user_agent=actor["userAgent"],
        )
    return view(actor["hospitalId"], batch_id)


def _resolves(kind: str, ref: str, refs: dict[str, str], in_file: set[str]) -> bool:
    return f"{kind}:{ref}" in refs or f"{kind}:{ref}" in in_file


def _decide(hospital_id: str, record: dict[str, Any], refs: dict[str, str], in_file: set[str]) -> dict[str, Any]:
    kind = ref_kind_of(record)
    existing = refs.get(_key_of(record))

    def update(target_id: str) -> dict[str, Any]:
        return {"action": "update", "errors": [], "targetKind": kind, "targetId": target_id}

    add = {"action": "add", "errors": [], "targetKind": kind, "targetId": None}

    if "type" not in record:
        if "patientRef" in record:
            return _decide_appointment(hospital_id, record, refs, existing)
        return add if existing is None else update(existing)

    row_type = record["type"]
    if row_type == "department":
        if existing is not None:
            return update(existing)
        adopted = repo.department_id_by_code(hospital_id, record["code"])
        return add if adopted is None else update(adopted)
    if row_type == "doctor":
        if not _resolves("department", record["departmentRef"], refs, in_file):
            return _fail("department_ref", "unknown_ref")
        return add if existing is None else update(existing)
    if row_type == "schedule":
        if not _resolves("doctor", record["doctorRef"], refs, in_file):
            return _fail("doctor_ref", "unknown_ref")
        return add if existing is None else update(existing)
    if row_type == "ward":
        return add if existing is None else update(existing)
    if row_type == "bed":
        if not _resolves("ward", record["wardRef"], refs, in_file):
            return _fail("ward_ref", "unknown_ref")
        holder = repo.bed_id_by_label(hospital_id, record["label"])
        if holder is not None and holder != existing:
            return _fail("bed_label", "conflict")
        return add if existing is None else update(existing)
    # staff
    if existing is not None:
        return update(existing)
    account = repo.staff_id_by_email(hospital_id, record["email"])
    return add if account is None else {"action": "skip", "errors": [], "targetKind": None, "targetId": None}


def _decide_appointment(
    hospital_id: str, record: dict[str, Any], refs: dict[str, str], existing: str | None
) -> dict[str, Any]:
    if f"patient:{record['patientRef']}" not in refs:
        return _fail("patient_ref", "unknown_ref")
    doctor_hospital_id = refs.get(f"doctor:{record['doctorRef']}")
    if doctor_hospital_id is None:
        return _fail("doctor_ref", "unknown_ref")
    if record["date"] < _today():
        return _fail("date", "out_of_range")
    chamber = settings_repo.chamber_of_doctor(hospital_id, doctor_hospital_id)
    if chamber is None:
        return _fail("doctor_ref", "unknown_ref")
    session = repo.chamber_for(
        hospital_id=hospital_id,
        doctor_id=chamber["doctorId"],
        department_id=chamber["departmentId"],
        date=record["date"],
        start_time=record["startTime"],
    )
    if session is None:
        return _fail("date", "no_chamber")
    if repo.serial_held(session["id"], record["serial"], existing):
        return _fail("serial", "serial_taken")
    if existing is None:
        return {"action": "add", "errors": [], "targetKind": "appointment", "targetId": None}
    return {"action": "update", "errors": [], "targetKind": "appointment", "targetId": existing}


# --- commit (FR-IMP-06) -------------------------------------------------------

STRUCTURE_ORDER = ("department", "doctor", "schedule", "ward", "bed", "staff")

TABLE_OF = {
    "department": "departments",
    "doctor": "doctor_hospitals",
    "schedule": "session_templates",
    "ward": "wards",
    "bed": "beds",
    "staff": "staff_users",
    "patient": "patients",
    "appointment": "bookings",
}


def commit(actor: dict[str, Any], batch_id: str) -> dict[str, Any]:
    touched_sessions: list[str] = []
    wrote_schedules = False

    with db.transaction():
        repo.lock_writes(actor["hospitalId"])
        batch = repo.batch_of(actor["hospitalId"], batch_id, for_update=True)
        if batch is None:
            raise not_found("import")
        if batch["state"] != "checked":
            raise _wrong_state(batch["state"])
        if batch["counts"]["error"] > 0:
            raise _wrong_state("has_errors")

        set_kind = batch["setKind"]
        refs = repo.refs_of(actor["hospitalId"])
        index = {column: at for at, column in enumerate(IMPORT_COLUMNS[set_kind])}
        pending: list[dict[str, Any]] = []
        for row in repo.rows_of(batch_id):
            if row["action"] not in ("add", "update"):
                continue
            raw = row["raw"] or {}
            cells = [raw.get(column, "") for column in IMPORT_COLUMNS[set_kind]]
            result = read_row(set_kind, cells, index)
            if not result["ok"]:
                raise _wrong_state("row_changed")
            pending.append({"row": row, "record": result["record"]})

        def rank(record: dict[str, Any]) -> int:
            return STRUCTURE_ORDER.index(record["type"]) if "type" in record else 0

        pending.sort(key=lambda entry: (rank(entry["record"]), entry["row"]["rowNumber"]))

        for entry in pending:
            row, record = entry["row"], entry["record"]
            try:
                written = _write(actor, record, refs)
            except AppError:
                raise
            except Exception as cause:
                # A constraint the check could not foresee: nothing is written
                # (FR-IMP-06), and the row is named so the file can be fixed.
                raise AppError(
                    "IMPORT_STATE", details={"reason": "conflict", "rowNumber": row["rowNumber"]}, cause=cause
                ) from cause
            refs[_key_of(record)] = written["entityId"]
            repo.upsert_ref(
                hospital_id=actor["hospitalId"],
                kind=ref_kind_of(record),
                external_ref=record["ref"],
                entity_id=written["entityId"],
                batch_id=batch_id,
            )
            repo.mark_row_written(
                row["id"],
                target_kind=ref_kind_of(record),
                target_id=written["entityId"],
                previous=written["previous"],
                action="update" if written["previous"] is not None or row["action"] == "update" else "add",
            )
            if written["sessionId"] is not None and written["sessionId"] not in touched_sessions:
                touched_sessions.append(written["sessionId"])
            if record.get("type") == "schedule":
                wrote_schedules = True

        # Seal the final after-state, so the batch's own later writes cannot
        # look like another administrator's edits (FR-IMP-07).
        for row in repo.rows_of(batch_id):
            if row["targetId"] is None or row["targetKind"] is None or row["action"] not in ("add", "update"):
                continue
            table = TABLE_OF.get(row["targetKind"])
            if table is None:
                raise _wrong_state("unknown_target")
            after = repo.undo_fingerprint(table, row["targetId"])
            previous = row["previous"] or {}
            replaced = previous.get("replacedTemplateId")
            replaced_after = repo.undo_fingerprint("session_templates", replaced) if isinstance(replaced, str) else None
            repo.mark_row_written(
                row["id"],
                target_kind=row["targetKind"],
                target_id=row["targetId"],
                previous={**previous, "__importUndo": {"version": 1, "after": after, "replacedAfter": replaced_after}},
            )
        repo.set_state(batch_id, "committed", actor["staffId"])
        repo.audit(
            actor_staff_id=actor["staffId"],
            hospital_id=actor["hospitalId"],
            batch_id=batch_id,
            event="committed",
            meta={"counts": batch["counts"]},
            ip=actor["ip"],
            user_agent=actor["userAgent"],
        )

    # After the commit: schedules become chambers, and every chamber that
    # gained an appointment tells its screens.
    if wrote_schedules:
        materialise()
    for session_id in touched_sessions:
        broadcast_roster(session_id)
    return view(actor["hospitalId"], batch_id)


def _write(actor: dict[str, Any], record: dict[str, Any], refs: dict[str, str]) -> dict[str, Any]:
    existing = refs.get(_key_of(record))

    def done(entity_id: str, previous: dict[str, Any] | None = None) -> dict[str, Any]:
        return {"entityId": entity_id, "previous": previous, "sessionId": None}

    hospital_id = actor["hospitalId"]
    if "type" not in record:
        if "patientRef" in record:
            return _write_appointment(actor, record, refs, existing)
        values = {
            "full_name": record["fullName"],
            "date_of_birth": record["dateOfBirth"],
            "age_years": record["ageYears"],
            "sex": record["sex"],
            "phone": record["phone"],
            "blood_group": record["bloodGroup"],
        }
        if existing is None:
            return done(repo.insert_hospital_patient(hospital_id=hospital_id, **values))
        previous = repo.current_values(
            "patients", existing, ["full_name", "date_of_birth", "age_years", "sex", "phone", "blood_group"]
        )
        repo.update_hospital_patient(existing, **values)
        return done(existing, previous)

    row_type = record["type"]
    if row_type == "department":
        adopted = existing or repo.department_id_by_code(hospital_id, record["code"])
        if adopted is None:
            return done(
                settings_repo.create_department(
                    hospital_id=hospital_id,
                    name_bn=record["nameBn"],
                    name_en=record["nameEn"],
                    code=record["code"],
                    sort_order=0,
                    created_by=actor["staffId"],
                )
            )
        previous = repo.current_values("departments", adopted, ["name_bn", "name_en"])
        settings_repo.update_department(hospital_id, adopted, {"nameBn": record["nameBn"], "nameEn": record["nameEn"]})
        return done(adopted, previous)
    if row_type == "doctor":
        department_id = refs.get(f"department:{record['departmentRef']}")
        if department_id is None:
            raise _wrong_state("unknown_department")
        if existing is not None:
            previous = repo.current_values("doctor_hospitals", existing, ["fee_poisha", "room"])
            settings_repo.update_doctor_hospital(existing, {"feePoisha": record["feePoisha"], "room": record["room"]})
            chamber = settings_repo.chamber_of_doctor(hospital_id, existing)
            if chamber is not None:
                settings_repo.carry_to_scheduled_sessions(
                    hospital_id=hospital_id,
                    doctor_id=chamber["doctorId"],
                    department_id=chamber["departmentId"],
                    fields={"feePoisha": record["feePoisha"], "room": record["room"]},
                )
            return done(existing, previous)
        known = settings_repo.doctor_by_bmdc(record["bmdcNumber"])
        doctor_id = (
            known["id"]
            if known is not None
            else settings_repo.create_doctor(
                name_bn=record["nameBn"],
                name_en=record["nameEn"],
                bmdc_number=record["bmdcNumber"],
                degrees=record["degrees"],
                specialties=record["specialties"],
                default_consult_minutes=15,
                created_by=actor["staffId"],
            )
        )
        linked = repo.doctor_hospital_for(hospital_id=hospital_id, doctor_id=doctor_id, department_id=department_id)
        if linked is not None:
            return done(linked, repo.current_values("doctor_hospitals", linked, ["fee_poisha", "room"]))
        return done(
            settings_repo.link_doctor(
                doctor_id=doctor_id,
                hospital_id=hospital_id,
                department_id=department_id,
                fee_poisha=record["feePoisha"],
                room=record["room"],
                created_by=actor["staffId"],
            )
        )
    if row_type == "schedule":
        doctor_hospital_id = refs.get(f"doctor:{record['doctorRef']}")
        if doctor_hospital_id is None:
            raise _wrong_state("unknown_doctor")
        # A changed schedule is a new one: the old one ends, taking its unbooked chambers.
        if existing is not None:
            settings_repo.end_template(existing)
        template_id = settings_repo.create_template(
            doctor_hospital_id=doctor_hospital_id,
            weekday=record["weekday"],
            start_time=record["startTime"],
            end_time=record["endTime"],
            capacity=record["capacity"],
            created_by=actor["staffId"],
        )
        return done(template_id, None if existing is None else {"replacedTemplateId": existing})
    if row_type == "ward":
        if existing is None:
            return done(
                settings_repo.create_ward(
                    hospital_id=hospital_id,
                    name_bn=record["nameBn"],
                    name_en=record["nameEn"],
                    floor=record["floor"],
                    kind=record["kind"],
                    created_by=actor["staffId"],
                )
            )
        previous = repo.current_values("wards", existing, ["name_bn", "name_en", "floor", "kind"])
        repo.restore_values(
            "wards",
            existing,
            {"name_bn": record["nameBn"], "name_en": record["nameEn"], "floor": record["floor"], "kind": record["kind"]},
        )
        return done(existing, previous)
    if row_type == "bed":
        ward_id = refs.get(f"ward:{record['wardRef']}")
        if ward_id is None:
            raise _wrong_state("unknown_ward")
        if existing is None:
            return done(
                settings_repo.create_bed(
                    hospital_id=hospital_id,
                    ward_id=ward_id,
                    label=record["label"],
                    kind=record["kind"],
                    nightly_poisha=record["nightlyPoisha"],
                    unconfirmed_reason=BED_UNCONFIRMED_REASON,
                    created_by=actor["staffId"],
                )
            )
        previous = repo.current_values("beds", existing, ["label", "nightly_poisha"])
        settings_repo.update_bed(hospital_id, existing, {"label": record["label"], "nightlyPoisha": record["nightlyPoisha"]})
        return done(existing, previous)
    # staff
    if existing is not None:
        previous = repo.current_values("staff_users", existing, ["full_name"])
        settings_repo.update_staff(existing, {"fullName": record["fullName"]})
        settings_repo.set_roles(staff_id=existing, hospital_id=hospital_id, roles=[record["role"]], by=actor["staffId"])
        return done(existing, previous)
    staff_id = staff_auth_repo.create_staff_account(
        hospital_id=hospital_id,
        email=record["email"],
        full_name=record["fullName"],
        staff_code=None,
        password_hash=NO_PASSWORD,
        created_by=actor["staffId"],
    )
    settings_repo.set_roles(staff_id=staff_id, hospital_id=hospital_id, roles=[record["role"]], by=actor["staffId"])
    return done(staff_id)


def _write_appointment(
    actor: dict[str, Any], record: dict[str, Any], refs: dict[str, str], existing: str | None
) -> dict[str, Any]:
    patient_id = refs.get(f"patient:{record['patientRef']}")
    doctor_hospital_id = refs.get(f"doctor:{record['doctorRef']}")
    if patient_id is None or doctor_hospital_id is None:
        raise _wrong_state("unknown_ref")
    chamber = settings_repo.chamber_of_doctor(actor["hospitalId"], doctor_hospital_id)
    if chamber is None:
        raise _wrong_state("unknown_doctor")
    session = repo.chamber_for(
        hospital_id=actor["hospitalId"],
        doctor_id=chamber["doctorId"],
        department_id=chamber["departmentId"],
        date=record["date"],
        start_time=record["startTime"],
    )
    if session is None:
        raise _wrong_state("no_chamber")
    if existing is not None:
        previous = repo.current_values("bookings", existing, ["serial_number", "intake"])
        repo.update_imported_booking(existing, serial=record["serial"], paid=record["paid"])
        return {"entityId": existing, "previous": previous, "sessionId": session["id"]}
    booking_id = repo.insert_imported_booking(
        session_id=session["id"],
        patient_id=patient_id,
        serial=record["serial"],
        fee_poisha=session["feePoisha"],
        paid=record["paid"],
        created_by=actor["staffId"],
    )
    return {"entityId": booking_id, "previous": None, "sessionId": session["id"]}


# --- undo (FR-IMP-07) and discard --------------------------------------------

UNDO_ORDER = ("appointment", "staff", "bed", "ward", "schedule", "doctor", "department", "patient")


def _blocked(blocking: list[dict[str, Any]]) -> AppError:
    return AppError("IMPORT_UNDO_BLOCKED", details={"blocking": blocking})


def undo(actor: dict[str, Any], batch_id: str) -> dict[str, Any]:
    touched_sessions: list[str] = []
    with db.transaction():
        repo.lock_writes(actor["hospitalId"])
        batch = repo.batch_of(actor["hospitalId"], batch_id, for_update=True)
        if batch is None:
            raise not_found("import")
        if batch["state"] != "committed":
            raise _wrong_state(batch["state"])

        written = [
            row
            for row in repo.rows_of(batch_id)
            if row["targetId"] is not None and row["targetKind"] is not None and row["action"] in ("add", "update")
        ]
        own = [row["targetId"] or "" for row in written]

        def replaced_of(row: dict[str, Any]) -> Any:
            return (row["previous"] or {}).get("replacedTemplateId")

        templates: list[str] = []
        for row in written:
            if row["targetKind"] != "schedule":
                continue
            templates.append(row["targetId"] or "")
            if isinstance(replaced_of(row), str):
                templates.append(replaced_of(row))
        repo.lock_undo_templates(templates)
        repo.lock_undo_sessions(templates, [row["targetId"] or "" for row in written if row["targetKind"] == "appointment"])

        # Every after-state checked under the locks before any undo write.
        # Batches without this evidence fail closed rather than erase later work.
        blocking: list[dict[str, Any]] = []
        ordered = sorted(
            written, key=functools.cmp_to_key(lambda a, b: locale_compare(a["targetId"] or "", b["targetId"] or ""))
        )
        for row in ordered:
            table = TABLE_OF.get(row["targetKind"] or "")
            evidence = (row["previous"] or {}).get("__importUndo")
            expected = evidence if isinstance(evidence, dict) else None
            actual = None if table is None else repo.undo_fingerprint(table, row["targetId"] or "")
            replaced = replaced_of(row)
            replaced_actual = repo.undo_fingerprint("session_templates", replaced) if isinstance(replaced, str) else None
            if (
                expected is None
                or expected.get("version") != 1
                or not isinstance(expected.get("after"), str)
                or actual != expected.get("after")
                or replaced_actual != expected.get("replacedAfter")
                # Updates with linked role or chamber side effects have no complete
                # reversible preimage: the whole undo is refused.
                or (row["action"] == "update" and row["targetKind"] in ("staff", "doctor"))
            ):
                blocking.append({"rowNumber": row["rowNumber"], "kind": row["targetKind"] or "unknown"})
        aliased = set(repo.alias_users(batch_id, [row["targetId"] or "" for row in written if row["action"] == "add"]))
        for row in written:
            if (row["targetId"] or "") in aliased:
                blocking.append({"rowNumber": row["rowNumber"], "kind": row["targetKind"] or "unknown"})
        for kind in UNDO_ORDER:
            added = [row for row in written if row["targetKind"] == kind]
            ids: list[str] = []
            for row in added:
                ids.append(row["targetId"] or "")
                if kind == "schedule" and isinstance(replaced_of(row), str):
                    ids.append(replaced_of(row))
            held = set(repo.held_by_others(kind=kind, ids=ids, own=own))
            for row in added:
                replaced = replaced_of(row)
                if (row["targetId"] or "") in held or (isinstance(replaced, str) and replaced in held):
                    blocking.append({"rowNumber": row["rowNumber"], "kind": kind})
        if blocking:
            raise _blocked(sorted(blocking, key=lambda entry: entry["rowNumber"]))

        for kind in UNDO_ORDER:
            table = TABLE_OF.get(kind)
            if table is None:
                continue
            for row in reversed([row for row in written if row["targetKind"] == kind]):
                row_id = row["targetId"] or ""
                if kind == "appointment":
                    session = repo.session_of_booking(row_id)
                    if session is not None and session not in touched_sessions:
                        touched_sessions.append(session)
                if row["action"] == "add":
                    if kind == "schedule":
                        settings_repo.end_template(row_id)
                    elif kind == "staff":
                        repo.retire_staff(row_id)
                    else:
                        repo.soft_delete(table, [row_id])
                elif kind == "schedule":
                    # An updated schedule was a replacement: end the new, bring back the old.
                    settings_repo.end_template(row_id)
                    replaced = replaced_of(row)
                    if isinstance(replaced, str):
                        repo.revive_template(replaced)
                        if not repo.restore_ref_target(
                            hospital_id=actor["hospitalId"],
                            external_ref=(row["raw"] or {}).get("ref", ""),
                            current_id=row_id,
                            previous_id=replaced,
                        ):
                            raise _blocked([{"rowNumber": row["rowNumber"], "kind": kind}])
                elif row["previous"] is not None:
                    before = {key: value for key, value in row["previous"].items() if key != "__importUndo"}
                    repo.restore_values(table, row_id, before)

        repo.drop_refs_of(batch_id)
        repo.set_state(batch_id, "undone", actor["staffId"])
        repo.audit(
            actor_staff_id=actor["staffId"],
            hospital_id=actor["hospitalId"],
            batch_id=batch_id,
            event="undone",
            meta={"rows": len(written)},
            ip=actor["ip"],
            user_agent=actor["userAgent"],
        )
    materialise()
    for session_id in touched_sessions:
        broadcast_roster(session_id)
    return view(actor["hospitalId"], batch_id)


def discard(actor: dict[str, Any], batch_id: str) -> dict[str, Any]:
    with db.transaction():
        batch = repo.batch_of(actor["hospitalId"], batch_id, for_update=True)
        if batch is None:
            raise not_found("import")
        if batch["state"] != "checked":
            raise _wrong_state(batch["state"])
        repo.set_state(batch_id, "discarded", actor["staffId"])
        repo.audit(
            actor_staff_id=actor["staffId"],
            hospital_id=actor["hospitalId"],
            batch_id=batch_id,
            event="discarded",
            meta={},
            ip=actor["ip"],
            user_agent=actor["userAgent"],
        )
    return view(actor["hospitalId"], batch_id)


def purge_expired() -> int:
    """Clears the rows of batches closed more than 30 days ago (FR-IMP-08); run hourly."""
    return repo.purge_expired()
