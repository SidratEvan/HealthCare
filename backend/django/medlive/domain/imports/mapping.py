"""Mapping a hospital's own export onto the import template
(port of `imports/mapping.ts`; PRD.md §14b, FR-IMP-13..20).

It looks at a file's columns, proposes which is which template field, and,
once a person has confirmed, rewrites the file into the template's shape for
the check that decides what is importable (FR-IMP-19). A column's profile
holds no value from any row, which is what a model may be shown (FR-IMP-17).
A first row that reads as data stops the upload: a patient's details are
never taken for a column name (FR-IMP-14). Pure and deterministic.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from ...core.schema import js_length, js_trim
from ..phone import normalise_bd_mobile
from ..time import js_round
from .csv import csv_line
from .sets import IMPORT_COLUMNS, latin_digits, read_date, read_time, taka_to_poisha

STRUCTURE_TYPES = ("department", "doctor", "schedule", "ward", "bed", "staff")
COLUMN_KINDS = ("empty", "text", "integer", "money", "date", "time", "phone", "email")

_REF_NAMES = ["id", "ref", "reference", "আইডি"]
_PATIENT_REF_NAMES = [
    "patient id", "patient no", "patient number", "patient code", "pid", "mrn", "uhid", "hospital no",
    "reg no", "registration no", "রোগীর আইডি", "রোগী নম্বর", "রোগীর নম্বর", "নিবন্ধন নম্বর",
]  # fmt: skip
_DOCTOR_REF_NAMES = ["doctor id", "doctor code", "dr id", "doctor", "consultant", "ডাক্তারের আইডি", "ডাক্তার"]
_NAME_BN = ["name bn", "bangla name", "name bangla", "name in bangla", "বাংলা নাম", "নাম"]
_NAME_EN = ["name", "name en", "english name", "name english", "full name", "ইংরেজি নাম"]
_BED_KIND_NAMES = ["bed type", "bed kind", "type", "kind", "category", "বেডের ধরন"]


def _f(field: str, required: bool, kinds: list[str], names: list[str]) -> dict[str, Any]:
    return {"field": field, "required": required, "kinds": kinds, "names": names}


_FIELDS: dict[str, list[dict[str, Any]]] = {
    "patients": [
        _f("ref", True, [], [*_PATIENT_REF_NAMES, *_REF_NAMES]),
        _f("full_name", True, ["text"], ["name", "patient name", "full name", "নাম", "রোগীর নাম", "পুরো নাম"]),
        _f("date_of_birth", False, ["date"], ["dob", "date of birth", "birth date", "birthdate", "জন্ম তারিখ", "জন্মতারিখ"]),
        _f("age_years", False, ["integer"], ["age", "age years", "বয়স"]),
        _f("sex", True, ["text"], ["sex", "gender", "লিঙ্গ"]),
        _f(
            "mobile",
            False,
            ["phone"],
            [
                "mobile", "mobile no", "mobile number", "phone", "phone no", "phone number", "contact",
                "contact no", "cell", "মোবাইল", "মোবাইল নম্বর", "ফোন", "ফোন নম্বর",
            ],
        ),
        _f("blood_group", False, ["text"], ["blood group", "blood grp", "blood", "bg", "রক্তের গ্রুপ", "ব্লাড গ্রুপ"]),
    ],
    "appointments": [
        _f("patient_ref", True, [], [*_PATIENT_REF_NAMES, "patient"]),
        _f("doctor_ref", True, [], _DOCTOR_REF_NAMES),
        _f("date", True, ["date"], ["date", "appointment date", "visit date", "তারিখ"]),
        _f("start", False, ["time"], ["time", "start", "start time", "appointment time", "সময়"]),
        _f("serial", True, ["integer"], ["serial", "serial no", "sl", "sl no", "token", "token no", "সিরিয়াল", "ক্রমিক"]),
        _f("paid", False, ["text", "integer"], ["paid", "payment", "payment status", "পরিশোধ"]),
    ],
    "structure:department": [
        _f("ref", True, [], ["department id", "dept id", *_REF_NAMES]),
        _f("name_bn", True, ["text"], _NAME_BN),
        _f("name_en", True, ["text"], [*_NAME_EN, "department", "department name", "dept name"]),
        _f("code", True, ["text"], ["code", "short code", "dept code", "department code", "কোড"]),
    ],
    "structure:doctor": [
        _f("ref", True, [], [*_DOCTOR_REF_NAMES, *_REF_NAMES]),
        _f("name_bn", True, ["text"], _NAME_BN),
        _f("name_en", True, ["text"], [*_NAME_EN, "doctor name", "dr name"]),
        _f("bmdc_number", True, [], ["bmdc", "bmdc no", "bmdc number", "bmdc reg", "bmdc reg no", "বিএমডিসি", "বিএমডিসি নম্বর"]),
        _f("degrees", False, ["text"], ["degree", "degrees", "qualification", "qualifications", "ডিগ্রি", "যোগ্যতা"]),
        _f("specialties", False, ["text"], ["specialty", "speciality", "specialties", "specialization", "বিশেষত্ব"]),
        _f("department_ref", True, [], ["department", "dept", "department id", "dept id", "department code", "বিভাগ"]),
        _f("room", False, [], ["room", "room no", "chamber", "chamber no", "রুম", "কক্ষ"]),
        _f("fee_taka", True, ["integer", "money"], ["fee", "fees", "consultation fee", "visit fee", "visit", "ফি", "ভিজিট"]),
    ],
    "structure:schedule": [
        _f("ref", True, [], ["schedule id", *_REF_NAMES]),
        _f("doctor_ref", True, [], _DOCTOR_REF_NAMES),
        _f("weekday", True, ["text", "integer"], ["day", "weekday", "week day", "বার", "দিন"]),
        _f("start", True, ["time"], ["start", "start time", "from", "time from", "শুরু"]),
        _f("end", True, ["time"], ["end", "end time", "to", "time to", "শেষ"]),
        _f("serials", False, ["integer"], ["serials", "capacity", "max patients", "limit", "সিরিয়াল সংখ্যা"]),
    ],
    "structure:ward": [
        _f("ref", True, [], ["ward id", "ward no", *_REF_NAMES]),
        _f("name_bn", True, ["text"], _NAME_BN),
        _f("name_en", True, ["text"], [*_NAME_EN, "ward", "ward name"]),
        _f("floor", True, ["integer"], ["floor", "floor no", "তলা"]),
        _f("bed_kind", True, ["text"], _BED_KIND_NAMES),
    ],
    "structure:bed": [
        _f("ref", True, [], ["bed id", *_REF_NAMES]),
        _f("ward_ref", True, [], ["ward", "ward id", "ward no", "ওয়ার্ড"]),
        _f("bed_label", True, [], ["bed", "bed no", "bed number", "label", "বেড নম্বর"]),
        _f("bed_kind", True, ["text"], _BED_KIND_NAMES),
        _f("nightly_taka", True, ["integer", "money"], ["rate", "price", "charge", "rent", "per night", "nightly", "ভাড়া"]),
    ],
    "structure:staff": [
        _f("ref", True, [], ["employee id", "staff id", "emp id", *_REF_NAMES]),
        _f("name_bn", True, ["text"], [*_NAME_BN, *_NAME_EN, "staff name", "employee name"]),
        _f("email", True, ["email"], ["email", "e mail", "mail", "ইমেইল"]),
        _f("role", True, ["text"], ["role", "designation", "position", "পদবি", "ভূমিকা"]),
    ],
}

#: Pairs of which one is enough: a patient needs a date of birth or an age.
_ONE_OF: dict[str, list[list[str]]] = {"patients": [["date_of_birth", "age_years"]]}


def _target_key(target: dict[str, Any]) -> str:
    return f"structure:{target['rowType']}" if target["set"] == "structure" else target["set"]


def target_fields(target: dict[str, Any]) -> list[dict[str, Any]]:
    return _FIELDS.get(_target_key(target), [])


def target_one_of(target: dict[str, Any]) -> list[list[str]]:
    return _ONE_OF.get(_target_key(target), [])


# --- profiling (FR-IMP-14) ------------------------------------------------

PROFILE_ROWS = 500
_EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")


def kind_of_value(raw: str) -> str:
    value = js_trim(raw)
    if value == "":
        return "empty"
    if _EMAIL.fullmatch(value):
        return "email"
    latin = latin_digits(value)
    if normalise_bd_mobile(latin) is not None:
        return "phone"
    if read_date(value) is not None:
        return "date"
    if read_time(value) is not None:
        return "time"
    if re.fullmatch(r"[0-9]{1,9}", latin.replace(",", "")):
        return "integer"
    if taka_to_poisha(value) is not None:
        return "money"
    return "text"


def profile_columns(table: dict[str, Any]) -> list[dict[str, Any]]:
    """What each column holds: a kind when four in five filled cells are that kind, else text."""
    rows = table["rows"][:PROFILE_ROWS]
    columns: list[dict[str, Any]] = []
    for index, name in enumerate(table["header"]):
        counts: dict[str, int] = {}
        seen: set[str] = set()
        filled = 0
        max_length = 0
        for row in rows:
            cells = row["cells"]
            cell = js_trim(cells[index]) if index < len(cells) else ""
            if cell == "":
                continue
            filled += 1
            max_length = max(max_length, js_length(cell))
            seen.add(cell)
            kind = kind_of_value(cell)
            counts[kind] = counts.get(kind, 0) + 1
        kind = "empty" if filled == 0 else "text"
        if filled > 0:
            needed = filled * 0.8
            numeric = counts.get("integer", 0) + counts.get("money", 0)
            for candidate in ("email", "phone", "date", "time", "integer"):
                if counts.get(candidate, 0) >= needed:
                    kind = candidate
                    break
            if kind == "text" and numeric >= needed:
                kind = "money"
        if filled == 0:
            distinct = "none"
        elif len(seen) == 1:
            distinct = "one"
        elif len(seen) == filled:
            distinct = "unique"
        elif len(seen) <= 12:
            distinct = "few"
        else:
            distinct = "many"
        columns.append(
            {
                "index": index,
                "name": js_trim(name),
                "profile": {
                    "kind": kind,
                    "filled": 0 if not rows else js_round((filled / len(rows)) * 100) / 100,
                    "distinct": distinct,
                    "maxLength": max_length,
                },
            }
        )
    return columns


def header_looks_like_data(header: list[str]) -> bool:
    """A heading is a word; a phone, a date or an email in the first row is a person."""
    kinds = [kind for kind in (kind_of_value(cell) for cell in header) if kind != "empty"]
    if not kinds:
        return True
    if any(kind in ("phone", "date", "email") for kind in kinds):
        return True
    numeric = sum(1 for kind in kinds if kind in ("integer", "money"))
    return numeric * 2 >= len(kinds)


_TEMPLATE_REQUIRED = {
    "structure": ("type", "ref"),
    "patients": ("ref", "full_name", "sex"),
    "appointments": ("patient_ref", "doctor_ref", "date", "serial"),
}


def has_template_header(set_kind: str, header: list[str]) -> bool:
    names = {js_trim(name).lower() for name in header}
    return all(column in names for column in _TEMPLATE_REQUIRED[set_kind])


def fold_heading(raw: str) -> str:
    text = unicodedata.normalize("NFC", raw).lower()
    text = re.sub(r"[_\-./\\()\[\]:#*]+", " ", text)
    return js_trim(re.sub(r"\s+", " ", text))


def header_signature(header: list[str]) -> str:
    return "\u001f".join(fold_heading(name) for name in header)


# --- proposing (FR-IMP-15) ------------------------------------------------

MIN_CONFIDENCE = 0.5


def _name_score(heading: str, field: dict[str, Any]) -> dict[str, Any] | None:
    if heading == "":
        return None
    if heading == fold_heading(field["field"]):
        return {"score": 1, "reason": "same_name"}
    names = [fold_heading(name) for name in field["names"]]
    if heading in names:
        return {"score": 0.9, "reason": "known_name"}
    padded = f" {heading} "
    within = any(
        js_length(name) >= 3 and (f" {name} " in padded or padded in f" {name} ") for name in names
    )
    return {"score": 0.6, "reason": "similar_name"} if within else None


def propose_mapping(target: dict[str, Any], columns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """A column for each field, by rules alone; a column is proposed for one field only."""
    fields = target_fields(target)
    candidates: list[dict[str, Any]] = []
    for field in fields:
        for column in columns:
            if column["profile"]["kind"] == "empty":
                continue
            named = _name_score(fold_heading(column["name"]), field)
            if named is None:
                continue
            kind = column["profile"]["kind"]
            fits = len(field["kinds"]) == 0 or kind in field["kinds"]
            agrees = len(field["kinds"]) > 0 and fits
            if agrees:
                score = min(1, named["score"] + 0.05)
            elif fits or kind == "text":
                score = named["score"]
            else:
                score = named["score"] * 0.6
            candidates.append({"field": field["field"], "column": column["index"], "score": score, "reason": named["reason"]})
        # The only column of a distinctive kind, for the one field of that kind.
        distinctive = [kind for kind in field["kinds"] if kind in ("phone", "date", "time", "email")]
        if distinctive:
            same_kind = [column for column in columns if column["profile"]["kind"] in distinctive]
            fields_of_kind = [other for other in fields if any(kind in distinctive for kind in other["kinds"])]
            if len(same_kind) == 1 and len(fields_of_kind) == 1:
                candidates.append({"field": field["field"], "column": same_kind[0]["index"], "score": 0.5, "reason": "shape"})

    # Best first; a tie goes to the earlier field and then the earlier column.
    order = {field["field"]: index for index, field in enumerate(fields)}
    candidates.sort(key=lambda c: (-c["score"], order.get(c["field"], 0), c["column"]))

    taken: set[int] = set()
    chosen: dict[str, dict[str, Any]] = {}
    for candidate in candidates:
        if candidate["score"] < MIN_CONFIDENCE:
            continue
        if candidate["field"] in chosen or candidate["column"] in taken:
            continue
        chosen[candidate["field"]] = candidate
        taken.add(candidate["column"])

    proposals: list[dict[str, Any]] = []
    for field in fields:
        pick = chosen.get(field["field"])
        if pick is None:
            proposals.append({"field": field["field"], "column": None, "confidence": None, "source": None, "reason": None})
        else:
            proposals.append(
                {
                    "field": field["field"],
                    "column": pick["column"],
                    "confidence": js_round(pick["score"] * 100) / 100,
                    "source": "rule",
                    "reason": pick["reason"],
                }
            )
    return proposals


def guess_structure_type(columns: list[dict[str, Any]]) -> str | None:
    best: dict[str, Any] | None = None
    for row_type in STRUCTURE_TYPES:
        target = {"set": "structure", "rowType": row_type}
        required = [field for field in target_fields(target) if field["required"]]
        proposals = propose_mapping(target, columns)
        placed = [
            field
            for field in required
            if any(proposal["field"] == field["field"] and proposal["column"] is not None for proposal in proposals)
        ]
        if len(placed) * 2 < len(required):
            continue
        confidence = sum(proposal["confidence"] or 0 for proposal in proposals)
        score = len(placed) / len(required) + confidence / 100
        if best is None or score > best["score"]:
            best = {"type": row_type, "score": score}
    return None if best is None else best["type"]


# --- a confirmed mapping (FR-IMP-18, FR-IMP-19) ---------------------------


def target_of(set_kind: str, row_type: str | None) -> dict[str, Any] | None:
    if set_kind == "structure":
        return None if row_type is None else {"set": set_kind, "rowType": row_type}
    return {"set": set_kind, "rowType": None}


def mapping_problems(set_kind: str, mapping: dict[str, Any], column_count: int) -> list[dict[str, Any]]:
    target = target_of(set_kind, mapping["rowType"])
    if target is None:
        return [{"kind": "row_type_required"}]
    fields = target_fields(target)
    known = {field["field"] for field in fields}
    problems: list[dict[str, Any]] = []
    for field, column in mapping["fields"].items():
        if field not in known:
            problems.append({"kind": "unknown_field", "field": field})
        elif column is not None and (column < 0 or column >= column_count):
            problems.append({"kind": "no_such_column", "field": field})

    def mapped(field: str) -> bool:
        return mapping["fields"].get(field) is not None

    groups = target_one_of(target)
    eased = {field for group in groups for field in group}
    for field in fields:
        if field["required"] and field["field"] not in eased and not mapped(field["field"]):
            problems.append({"kind": "required_unmapped", "field": field["field"]})
    for group in groups:
        if not any(mapped(field) for field in group):
            problems.append({"kind": "one_of_unmapped", "fields": group})
    return problems


def unmapped_columns(mapping: dict[str, Any], columns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    used = {column for column in mapping["fields"].values() if column is not None}
    return [column for column in columns if column["index"] not in used]


def apply_mapping(set_kind: str, table: dict[str, Any], mapping: dict[str, Any]) -> str:
    """The file in the template's shape, row order kept, so the check reports the file's own rows."""
    columns = IMPORT_COLUMNS[set_kind]
    lines = [csv_line(columns)]
    for row in table["rows"]:
        cells = row["cells"]
        values: list[str] = []
        for column in columns:
            if set_kind == "structure" and column == "type":
                values.append(mapping["rowType"] or "")
                continue
            at = mapping["fields"].get(column)
            values.append("" if at is None or at >= len(cells) else js_trim(cells[at]))
        lines.append(csv_line(values))
    return "\n".join(lines) + "\n"


# --- a model's suggestions (FR-IMP-16, FR-IMP-17) ---------------------------

_FIELD_MEANING = {
    "ref": "The identifier the hospital itself uses for this row: a patient number, a doctor code, a bed id.",
    "name_bn": "The name written in Bangla script.",
    "name_en": "The name written in English (Latin script).",
    "code": "A short code for a department, such as MED or CARD.",
    "bmdc_number": "The Bangladesh Medical and Dental Council registration number of a doctor.",
    "degrees": "The degrees and qualifications of a doctor, such as MBBS, FCPS.",
    "specialties": "The specialties of a doctor.",
    "department_ref": "The identifier or code the hospital uses for the department a doctor sits in.",
    "room": "A room or chamber number.",
    "fee_taka": "A consultation fee in Bangladeshi taka.",
    "doctor_ref": "The identifier the hospital uses for a doctor.",
    "weekday": "A day of the week.",
    "start": "A start time.",
    "end": "An end time.",
    "serials": "How many patients a doctor sees in one sitting.",
    "ward_ref": "The identifier the hospital uses for a ward.",
    "floor": "A floor number.",
    "bed_kind": "The kind of bed: general, cabin, hdu, icu, ccu, nicu, isolation or burn.",
    "bed_label": "The number or label painted on a bed.",
    "nightly_taka": "The price of a bed per night in Bangladeshi taka.",
    "role": "The role or designation of a staff member.",
    "email": "An email address.",
    "full_name": "The full name of a patient.",
    "date_of_birth": "The date of birth of a patient.",
    "age_years": "The age of a patient in years.",
    "sex": "The sex or gender of a patient.",
    "mobile": "The mobile phone number of a patient.",
    "blood_group": "The blood group of a patient, such as B+ or O-.",
    "patient_ref": "The identifier the hospital uses for a patient.",
    "date": "The date of an appointment.",
    "serial": "The serial or token number of a patient in the queue.",
    "paid": "Whether the appointment has been paid for.",
}

#: Made up from the kind alone (FR-IMP-17): constants no cell can reach.
_EXAMPLE_OF_KIND: dict[str, str | None] = {
    "empty": None,
    "text": None,
    "integer": "123",
    "money": "1,250.00",
    "date": "DD/MM/YYYY",
    "time": "HH:MM",
    "phone": "01XXXXXXXXX",
    "email": "name@example.org",
}


def model_mapping_request(
    target: dict[str, Any], columns: list[dict[str, Any]], rules: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """What to ask a model, built from headings and profiles only; None when there is nothing to ask."""
    placed = {proposal["field"]: proposal["column"] for proposal in rules if proposal["column"] is not None}
    used_columns = set(placed.values())
    open_fields = [field for field in target_fields(target) if field["field"] not in placed]
    free_columns = [
        column for column in columns if column["index"] not in used_columns and column["profile"]["kind"] != "empty"
    ]
    if not open_fields or not free_columns:
        return None
    by_index = {column["index"]: column for column in columns}
    return {
        "set": target["set"],
        "rowType": target["rowType"],
        "fields": [
            {"field": field["field"], "required": field["required"], "means": _FIELD_MEANING.get(field["field"], field["field"])}
            for field in open_fields
        ],
        "columns": [
            {
                "index": column["index"],
                "heading": column["name"],
                "holds": column["profile"]["kind"],
                "filled": column["profile"]["filled"],
                "variety": column["profile"]["distinct"],
                "looksLike": _EXAMPLE_OF_KIND[column["profile"]["kind"]],
            }
            for column in free_columns
        ],
        "alreadyMatched": [
            {"field": field, "heading": by_index[index]["name"] if index in by_index else ""}
            for field, index in placed.items()
        ],
    }


_MODEL_CONFIDENCE = {"high": 0.8, "medium": 0.65, "low": 0.5}
MAX_NOTE = 200


def with_model_suggestions(
    rules: list[dict[str, Any]], asked: dict[str, Any], suggestions: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Adds a model's suggestions, kept only where they name a field asked about and a column offered.

    A model's answer is untrusted input: it can fill a gap the rules left and
    never change what they decided.
    """
    open_fields = {field["field"] for field in asked["fields"]}
    free_columns = {column["index"] for column in asked["columns"]}
    accepted: dict[str, dict[str, Any]] = {}
    taken: set[int] = set()
    for suggestion in suggestions:
        if suggestion["field"] not in open_fields or suggestion["field"] in accepted:
            continue
        column = suggestion["column"]
        # `Number.isInteger`: 2.0 is an integer in JavaScript.
        if isinstance(column, float) and column.is_integer():
            column = int(column)
        if not isinstance(column, int) or isinstance(column, bool) or column not in free_columns:
            continue
        if column in taken:
            continue
        accepted[suggestion["field"]] = {**suggestion, "column": column}
        taken.add(column)
    out: list[dict[str, Any]] = []
    for proposal in rules:
        suggestion = accepted.get(proposal["field"])
        if suggestion is None or proposal["column"] is not None:
            out.append(proposal)
            continue
        note = js_trim(re.sub(r"\s+", " ", suggestion["reason"]))
        out.append(
            {
                "field": proposal["field"],
                "column": suggestion["column"],
                "confidence": _MODEL_CONFIDENCE[suggestion["confidence"]],
                "source": "model",
                "reason": None,
                # Plain text, shortened, on one line; shown as written.
                "note": _js_slice(note, MAX_NOTE),
            }
        )
    return out


def _js_slice(text: str, units: int) -> str:
    """`text.slice(0, units)` in UTF-16 code units, as JavaScript cuts it."""
    if js_length(text) <= units:
        return text
    encoded = text.encode("utf-16-le")[: units * 2]
    return encoded.decode("utf-16-le", errors="ignore")
