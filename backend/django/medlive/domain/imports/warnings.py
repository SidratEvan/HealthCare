"""What a checked import is warned about without being refused (port of `imports/warnings.ts`; FR-IMP-21).

Two rows that look like the same patient under two identifiers (the same
name with the same mobile, or the same name with the same date of birth) are
flagged, never merged. A column that writes its dates or mobiles in more
than one accepted way is named, with how each is read. Pure, and it names
rows by number only: nothing here carries a value from a row (FR-IMP-11).
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from ...core.schema import js_trim
from ..phone import normalise_bd_mobile
from .sets import latin_digits, read_date

SAME_PERSON_REASONS = ("phone_and_name", "name_and_birth")
MAX_GROUPS_LISTED = 50

NO_WARNINGS: dict[str, Any] = {"samePerson": [], "samePersonTotal": 0, "mixedFormats": []}

_FORMAT_FIELDS: dict[str, tuple[tuple[str, str], ...]] = {
    "structure": (),
    "patients": (("date_of_birth", "date"), ("mobile", "phone")),
    "appointments": (("date", "date"),),
}

_NAME_PREFIXES = {
    "md", "mohammad", "mohammed", "muhammad", "mohd", "mst", "mosammat", "mosammad",
    "মো", "মোঃ", "মোহাম্মদ", "মুহাম্মদ", "মোছা", "মোছাঃ", "মোসাম্মৎ",
}  # fmt: skip


def fold_person_name(name: str) -> str:
    """A name as it is compared: case, punctuation, spacing and a leading title set aside."""
    text = re.sub(r"""[.,:;'"()\[\]]""", " ", unicodedata.normalize("NFC", name).lower())
    words = [word for word in re.split(r"\s+", text) if word != ""]
    rest = words[1:] if len(words) > 1 and words[0] in _NAME_PREFIXES else words
    return " ".join(rest)


def _date_format_of(value: str) -> str | None:
    if read_date(value) is None:
        return None
    return "iso" if re.match(r"[0-9]{4}-", js_trim(latin_digits(value))) else "day_first"


def _phone_format_of(value: str) -> str | None:
    digits = re.sub(r"[\s\-().]", "", latin_digits(value))
    if normalise_bd_mobile(digits) is None:
        return None
    return "local" if digits.startswith("0") else "country"


def _mixed_formats_of(set_kind: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for field, kind in _FORMAT_FIELDS[set_kind]:
        seen: dict[str, dict[str, int]] = {}
        for row in rows:
            raw = row["raw"]
            value = None if raw is None else raw.get(field)
            if value is None or js_trim(value) == "":
                continue
            fmt = _date_format_of(value) if kind == "date" else _phone_format_of(value)
            # What cannot be read is the check's to refuse, not a format.
            if fmt is None:
                continue
            if fmt not in seen:
                seen[fmt] = {"rows": 1, "firstRow": row["rowNumber"]}
            else:
                seen[fmt]["rows"] += 1
        if len(seen) < 2:
            continue
        formats = [{"format": fmt, **entry} for fmt, entry in seen.items()]
        formats.sort(key=lambda entry: (-entry["rows"], entry["firstRow"]))
        found.append({"field": field, "kind": kind, "formats": formats})
    return found


def _same_person_of(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    patients: list[dict[str, Any]] = []
    parent: list[int] = []

    def find(at: int) -> int:
        root = at
        while parent[root] != root:
            root = parent[root]
        parent[at] = root
        return root

    first_with: dict[str, int] = {}
    reasons: dict[int, set[str]] = {}

    def join(key: str, at: int, because: str) -> None:
        other = first_with.get(key)
        if other is None:
            first_with[key] = at
            return
        a, b = find(other), find(at)
        merged = {*reasons.get(a, set()), *reasons.get(b, set()), because}
        parent[b] = a
        reasons.pop(b, None)
        reasons[a] = merged

    for row in rows:
        raw = row["raw"]
        if raw is None:
            continue
        ref = js_trim(raw.get("ref", ""))
        name = fold_person_name(raw.get("full_name", ""))
        # A template's example row is skipped by the import, and names nobody.
        if ref == "" or name == "" or ref.upper().startswith("EXAMPLE"):
            continue
        at = len(patients)
        patients.append({"rowNumber": row["rowNumber"], "ref": ref})
        parent.append(at)
        phone = normalise_bd_mobile(latin_digits(raw.get("mobile", "")))
        if phone is not None:
            join(f"phone|{phone}|{name}", at, "phone_and_name")
        born = read_date(raw.get("date_of_birth", ""))
        if born is not None:
            join(f"born|{born}|{name}", at, "name_and_birth")

    members: dict[int, list[dict[str, Any]]] = {}
    for at, patient in enumerate(patients):
        members.setdefault(find(at), []).append(patient)

    groups: list[dict[str, Any]] = []
    for root, group in members.items():
        # The same identifier twice is an error the check already names.
        if len({patient["ref"] for patient in group}) < 2:
            continue
        because = reasons.get(root, set())
        groups.append(
            {
                "rows": sorted(patient["rowNumber"] for patient in group),
                "because": [reason for reason in SAME_PERSON_REASONS if reason in because],
            }
        )
    return sorted(groups, key=lambda group: group["rows"][0] if group["rows"] else 0)


def import_warnings(set_kind: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    """What a person should look at before approving this file. Empty for most files."""
    same_person = _same_person_of(rows) if set_kind == "patients" else []
    return {
        "samePerson": same_person[:MAX_GROUPS_LISTED],
        "samePersonTotal": len(same_person),
        "mixedFormats": _mixed_formats_of(set_kind, rows),
    }


def has_warnings(warnings: dict[str, Any]) -> bool:
    return warnings["samePersonTotal"] > 0 or len(warnings["mixedFormats"]) > 0
