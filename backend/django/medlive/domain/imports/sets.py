"""What each import set holds, and how one row of it is read
(port of `imports/sets.ts`; FR-IMP-01, FR-IMP-02, FR-IMP-05, FR-IMP-09).

Only the fields FR-IMP-02 names have a column. A row is checked here for
what the row alone can show; whether what it refers to exists is the
service's check. Errors are codes (`{field, code}`), never sentences. Latin
or Bengali digits, Bangladeshi date and time spellings, and weekday names in
either language are read. Pure.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from ...core.schema import js_length, js_trim
from ..enums import BED_KINDS, BLOOD_GROUPS, SEXES
from ..phone import normalise_bd_mobile

#: `records` (set D) waits (FR-IMP-12).
IMPORT_SETS = ("structure", "patients", "appointments")

IMPORT_COLUMNS: dict[str, tuple[str, ...]] = {
    "structure": (
        "type",
        "ref",
        "name_bn",
        "name_en",
        "code",
        "bmdc_number",
        "degrees",
        "specialties",
        "department_ref",
        "room",
        "fee_taka",
        "doctor_ref",
        "weekday",
        "start",
        "end",
        "serials",
        "ward_ref",
        "floor",
        "bed_kind",
        "bed_label",
        "nightly_taka",
        "role",
        "email",
    ),
    "patients": ("ref", "full_name", "date_of_birth", "age_years", "sex", "mobile", "blood_group"),
    "appointments": ("patient_ref", "doctor_ref", "date", "start", "serial", "paid"),
}

STAFF_ROLES = ("receptionist", "doctor", "ward", "emergency", "lab", "pharmacy", "hospital_admin")


def ref_kind_of(record: dict[str, Any]) -> str:
    """Which kind of external reference a record's `ref` names (`external_refs.kind`)."""
    if "type" in record:
        return record["type"]
    if "patientRef" in record:
        return "appointment"
    return "patient"


def column_index(set_kind: str, header: list[str]) -> dict[str, int]:
    normalised = [js_trim(name).lower() for name in header]
    return {column: normalised.index(column) if column in normalised else -1 for column in IMPORT_COLUMNS[set_kind]}


_REQUIRED_COLUMNS = {
    "structure": ("type", "ref"),
    "patients": ("ref", "full_name", "sex"),
    "appointments": ("patient_ref", "doctor_ref", "date", "serial"),
}


def missing_columns(set_kind: str, header: list[str]) -> list[str]:
    index = column_index(set_kind, header)
    return [column for column in _REQUIRED_COLUMNS[set_kind] if index.get(column, -1) < 0]


class _Reader:
    def __init__(self, cells: list[str], index: dict[str, int]) -> None:
        self.cells = cells
        self.index = index
        self.errors: list[dict[str, str]] = []

    def raw(self, field: str) -> str:
        at = self.index.get(field, -1)
        if at < 0 or at >= len(self.cells):
            return ""
        return js_trim(self.cells[at])

    def optional(self, field: str) -> str | None:
        value = self.raw(field)
        return None if value == "" else value

    def required(self, field: str) -> str:
        value = self.raw(field)
        if value == "":
            self.errors.append({"field": field, "code": "required"})
        return value

    def fail(self, field: str, code: str) -> None:
        self.errors.append({"field": field, "code": code})


_BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯"
_BENGALI_DIGIT = re.compile("[০-৯]")


def latin_digits(value: str) -> str:
    """Bengali digits to Latin, so `০১৭১২...` and `৮০০` read as numbers."""
    return _BENGALI_DIGIT.sub(lambda m: str(_BENGALI_DIGITS.index(m.group(0))), value)


def _whole_number(value: str) -> int | None:
    text = js_trim(latin_digits(value).replace(",", ""))
    return int(text) if re.fullmatch(r"[0-9]{1,9}", text) else None


_TAKA_NOISE = re.compile(r"[,৳\s]|tk\.?|taka", re.IGNORECASE)


def taka_to_poisha(value: str) -> int | None:
    """Taka as written (`800`, `800.50`, `1,500`, `৳৮০০`) to integer poisha (DB-P5)."""
    text = _TAKA_NOISE.sub("", latin_digits(value))
    match = re.fullmatch(r"([0-9]{1,7})(?:\.([0-9]{1,2}))?", text)
    if match is None:
        return None
    return int(match.group(1)) * 100 + int((match.group(2) or "").ljust(2, "0"))


def read_date(value: str) -> str | None:
    """`2026-10-05`, `05/10/2026`, `5-10-2026` -> `2026-10-05`; day first, as Bangladesh writes it."""
    text = js_trim(latin_digits(value))
    iso = re.fullmatch(r"([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})", text)
    day_first = re.fullmatch(r"([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{4})", text)
    if iso is not None:
        year, month, day = int(iso.group(1)), int(iso.group(2)), int(iso.group(3))
    elif day_first is not None:
        day, month, year = int(day_first.group(1)), int(day_first.group(2)), int(day_first.group(3))
    else:
        return None
    # JavaScript's Date.UTC reads a two-digit year as 19xx, so a year below 100
    # never round-trips there: refused here too.
    if year < 100:
        return None
    try:
        datetime(year, month, day)
    except ValueError:
        return None
    return f"{year}-{month:02d}-{day:02d}"


def read_time(value: str) -> str | None:
    """`17:00`, `5:00 PM`, `5 pm`, `১৭:০০` -> `17:00`."""
    text = re.sub(r"\s+", " ", js_trim(latin_digits(value)).lower())
    match = re.fullmatch(r"([0-9]{1,2})(?:[:.]([0-9]{2}))?\s*(am|pm)?", text)
    if match is None:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2) or "0")
    half = match.group(3)
    if match.group(2) is None and half is None:
        return None
    if half is not None:
        if hour < 1 or hour > 12:
            return None
        if half == "pm" and hour != 12:
            hour += 12
        if half == "am" and hour == 12:
            hour = 0
    if hour > 23 or minute > 59:
        return None
    return f"{hour:02d}:{minute:02d}"


_WEEKDAYS = {
    "mon": 1, "monday": 1, "সোম": 1, "সোমবার": 1,
    "tue": 2, "tuesday": 2, "মঙ্গল": 2, "মঙ্গলবার": 2,
    "wed": 3, "wednesday": 3, "বুধ": 3, "বুধবার": 3,
    "thu": 4, "thursday": 4, "বৃহস্পতি": 4, "বৃহস্পতিবার": 4,
    "fri": 5, "friday": 5, "শুক্র": 5, "শুক্রবার": 5,
    "sat": 6, "saturday": 6, "শনি": 6, "শনিবার": 6,
    "sun": 7, "sunday": 7, "রবি": 7, "রবিবার": 7,
}  # fmt: skip


def read_weekday(value: str) -> int | None:
    """ISO 1-7 (Monday = 1), from a number or a name in either language."""
    text = js_trim(latin_digits(value)).lower()
    if re.fullmatch(r"[1-7]", text):
        return int(text)
    return _WEEKDAYS.get(text)


_SEX_WORDS = {
    "m": "male", "male": "male", "পুরুষ": "male", "ছেলে": "male",
    "f": "female", "female": "female", "মহিলা": "female", "নারী": "female", "মেয়ে": "female",
    "o": "other", "other": "other", "অন্য": "other", "অন্যান্য": "other",
}  # fmt: skip

_YES = {"yes", "y", "true", "1", "paid", "হ্যাঁ", "হা", "পরিশোধিত"}
_NO = {"no", "n", "false", "0", "unpaid", "না", "বাকি", ""}


def _bed_kind_of(row: _Reader) -> str:
    text = row.required("bed_kind").lower()
    kind = text if text in BED_KINDS else None
    if text != "" and kind is None:
        row.fail("bed_kind", "unknown_value")
    return kind or "general"


def _read_structure(row: _Reader) -> dict[str, Any] | None:
    kind = row.required("type").lower()
    ref = row.required("ref")
    if kind == "department":
        name_bn = row.required("name_bn")
        name_en = row.required("name_en")
        code = row.required("code").upper()
        if code != "" and not re.fullmatch(r"[A-Z][A-Z0-9-]{1,11}", code):
            row.fail("code", "invalid")
        return {"type": kind, "ref": ref, "nameBn": name_bn, "nameEn": name_en, "code": code}
    if kind == "doctor":
        name_bn = row.required("name_bn")
        name_en = row.required("name_en")
        bmdc_number = latin_digits(row.required("bmdc_number")).upper()
        if bmdc_number != "" and not re.fullmatch(r"[A-Z]{0,6}-?[0-9]{1,7}", bmdc_number):
            row.fail("bmdc_number", "invalid")
        specialties = [
            re.sub(r"\s+", "_", js_trim(entry).lower())
            for entry in re.split(r"[;|]", row.optional("specialties") or "")
        ]
        specialties = [entry for entry in specialties if entry != ""]
        if any(not re.fullmatch(r"[a-z][a-z_-]{1,40}", entry) for entry in specialties):
            row.fail("specialties", "invalid")
        department_ref = row.required("department_ref")
        fee_text = row.required("fee_taka")
        fee_poisha = 0 if fee_text == "" else taka_to_poisha(fee_text)
        if fee_poisha is None:
            row.fail("fee_taka", "invalid")
        return {
            "type": kind,
            "ref": ref,
            "nameBn": name_bn,
            "nameEn": name_en,
            "bmdcNumber": bmdc_number,
            "degrees": row.optional("degrees"),
            "specialties": specialties[:5],
            "departmentRef": department_ref,
            "room": row.optional("room"),
            "feePoisha": fee_poisha or 0,
        }
    if kind == "schedule":
        doctor_ref = row.required("doctor_ref")
        weekday_text = row.required("weekday")
        weekday = 0 if weekday_text == "" else read_weekday(weekday_text)
        if weekday is None:
            row.fail("weekday", "unknown_value")
        start_text = row.required("start")
        end_text = row.required("end")
        start_time = "" if start_text == "" else read_time(start_text)
        end_time = "" if end_text == "" else read_time(end_text)
        if start_time is None:
            row.fail("start", "bad_time")
        if end_time is None:
            row.fail("end", "bad_time")
        if start_time and end_time and end_time <= start_time:
            row.fail("end", "end_before_start")
        serials_text = row.optional("serials")
        capacity = None if serials_text is None else _whole_number(serials_text)
        if serials_text is not None and (capacity is None or capacity < 1 or capacity > 500):
            row.fail("serials", "out_of_range")
        return {
            "type": kind,
            "ref": ref,
            "doctorRef": doctor_ref,
            "weekday": weekday or 0,
            "startTime": start_time or "",
            "endTime": end_time or "",
            "capacity": capacity,
        }
    if kind == "ward":
        name_bn = row.required("name_bn")
        name_en = row.required("name_en")
        floor_text = row.required("floor")
        floor = 0 if floor_text == "" else _whole_number(floor_text)
        if floor is None or floor > 60:
            row.fail("floor", "out_of_range")
        bed_kind = _bed_kind_of(row)
        return {"type": kind, "ref": ref, "nameBn": name_bn, "nameEn": name_en, "floor": floor or 0, "kind": bed_kind}
    if kind == "bed":
        ward_ref = row.required("ward_ref")
        label = row.required("bed_label")
        if js_length(label) > 20:
            row.fail("bed_label", "invalid")
        bed_kind = _bed_kind_of(row)
        price_text = row.required("nightly_taka")
        nightly_poisha = 0 if price_text == "" else taka_to_poisha(price_text)
        if nightly_poisha is None:
            row.fail("nightly_taka", "invalid")
        return {
            "type": kind,
            "ref": ref,
            "wardRef": ward_ref,
            "label": label,
            "kind": bed_kind,
            "nightlyPoisha": nightly_poisha or 0,
        }
    if kind == "staff":
        full_name = row.optional("name_bn") or row.optional("name_en") or ""
        if full_name == "":
            row.fail("name_bn", "required")
        email = row.required("email")
        if email != "" and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            row.fail("email", "invalid")
        role_text = re.sub(r"\s+", "_", row.required("role").lower())
        role = role_text if role_text in STAFF_ROLES else None
        if role_text != "" and role is None:
            row.fail("role", "unknown_value")
        return {"type": kind, "ref": ref, "fullName": full_name, "email": email, "role": role or "receptionist"}
    if kind != "":
        row.fail("type", "unknown_type")
    return None


def _read_patient(row: _Reader) -> dict[str, Any]:
    ref = row.required("ref")
    full_name = row.required("full_name")
    dob_text = row.optional("date_of_birth")
    date_of_birth = None if dob_text is None else read_date(dob_text)
    if dob_text is not None and date_of_birth is None:
        row.fail("date_of_birth", "bad_date")
    age_text = row.optional("age_years")
    age_years = None if age_text is None else _whole_number(age_text)
    if age_text is not None and (age_years is None or age_years > 130):
        row.fail("age_years", "out_of_range")
    if dob_text is None and age_text is None:
        row.fail("age_years", "required")
    sex_text = row.required("sex").lower()
    sex = _SEX_WORDS.get(sex_text) or (sex_text if sex_text in SEXES else None)
    if sex_text != "" and sex is None:
        row.fail("sex", "unknown_value")
    mobile_text = row.optional("mobile")
    phone = None if mobile_text is None else normalise_bd_mobile(latin_digits(mobile_text))
    if mobile_text is not None and phone is None:
        row.fail("mobile", "not_bd_mobile")
    blood_text = row.optional("blood_group")
    blood = None if blood_text is None else re.sub(r"\s+", "", blood_text.upper()).replace("VE", "", 1)
    blood_unknown = blood is not None and blood not in BLOOD_GROUPS
    if blood_unknown:
        row.fail("blood_group", "unknown_value")
    return {
        "ref": ref,
        "fullName": full_name,
        "dateOfBirth": date_of_birth,
        "ageYears": age_years,
        "sex": sex or "other",
        "phone": phone,
        "bloodGroup": None if blood is None or blood_unknown else blood,
    }


def _read_appointment(row: _Reader) -> dict[str, Any]:
    patient_ref = row.required("patient_ref")
    doctor_ref = row.required("doctor_ref")
    date_text = row.required("date")
    date = "" if date_text == "" else read_date(date_text)
    if date is None:
        row.fail("date", "bad_date")
    start_text = row.optional("start")
    start_time = None if start_text is None else read_time(start_text)
    if start_text is not None and start_time is None:
        row.fail("start", "bad_time")
    serial_text = row.required("serial")
    serial = 0 if serial_text == "" else _whole_number(serial_text)
    if serial is None or (serial_text != "" and (serial < 1 or serial > 999)):
        row.fail("serial", "out_of_range")
    paid_text = latin_digits(row.raw("paid")).lower()
    paid = True if paid_text in _YES else False if paid_text in _NO else None
    if paid is None:
        row.fail("paid", "unknown_value")
    return {
        "ref": f"{patient_ref}|{doctor_ref}|{date or ''}",
        "patientRef": patient_ref,
        "doctorRef": doctor_ref,
        "date": date or "",
        "startTime": start_time,
        "serial": serial or 0,
        "paid": paid or False,
    }


def read_row(set_kind: str, cells: list[str], index: dict[str, int]) -> dict[str, Any]:
    """One row of a set, read and checked on its own: `{ok, record}` or `{ok, errors}`."""
    row = _Reader(cells, index)
    if set_kind == "structure":
        record = _read_structure(row)
    elif set_kind == "patients":
        record = _read_patient(row)
    else:
        record = _read_appointment(row)
    if record is None or row.errors:
        return {"ok": False, "errors": row.errors if row.errors else [{"field": "type", "code": "required"}]}
    return {"ok": True, "record": record}


_EXAMPLES: dict[str, list[dict[str, str]]] = {
    "structure": [
        {"type": "department", "ref": "EXAMPLE-D-01", "name_bn": "মেডিসিন (উদাহরণ)", "name_en": "Medicine (example)", "code": "MED"},
        {
            "type": "doctor",
            "ref": "EXAMPLE-DR-01",
            "name_bn": "ডা. উদাহরণ",
            "name_en": "Dr Example",
            "bmdc_number": "A-00000",
            "degrees": "MBBS",
            "specialties": "medicine",
            "department_ref": "EXAMPLE-D-01",
            "room": "204",
            "fee_taka": "800",
        },
        {
            "type": "schedule",
            "ref": "EXAMPLE-S-01",
            "doctor_ref": "EXAMPLE-DR-01",
            "weekday": "Saturday",
            "start": "17:00",
            "end": "21:00",
            "serials": "30",
        },
        {
            "type": "ward",
            "ref": "EXAMPLE-W-01",
            "name_bn": "সাধারণ ওয়ার্ড (উদাহরণ)",
            "name_en": "General ward (example)",
            "floor": "3",
            "bed_kind": "general",
        },
        {
            "type": "bed",
            "ref": "EXAMPLE-B-301",
            "ward_ref": "EXAMPLE-W-01",
            "bed_label": "301",
            "bed_kind": "general",
            "nightly_taka": "1500",
        },
        {"type": "staff", "ref": "EXAMPLE-ST-01", "name_bn": "উদাহরণ কর্মী", "role": "receptionist", "email": "example@example.invalid"},
    ],
    "patients": [
        {
            "ref": "EXAMPLE-P-000001",
            "full_name": "উদাহরণ রোগী",
            "date_of_birth": "01/01/1980",
            "age_years": "",
            "sex": "female",
            "mobile": "01700000000",
            "blood_group": "O+",
        }
    ],
    "appointments": [
        {
            "patient_ref": "EXAMPLE-P-000001",
            "doctor_ref": "EXAMPLE-DR-01",
            "date": "2026-10-03",
            "start": "17:00",
            "serial": "5",
            "paid": "no",
        }
    ],
}


def template_csv(set_kind: str) -> str:
    """The header, then example rows that say they are examples (FR-IMP-09). They name nobody."""
    from .csv import csv_field

    header = IMPORT_COLUMNS[set_kind]
    lines = [",".join(header)]
    for example in _EXAMPLES[set_kind]:
        lines.append(",".join(csv_field(example.get(column, "")) for column in header))
    return "\r\n".join(lines) + "\r\n"
