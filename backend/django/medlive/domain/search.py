"""What a patient's search is asking for, and how its answers are ordered
(ports of `search/needs.ts`, `search/order.ts` and `types/specialties.ts`;
FR-PAT-16..19)."""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from .enums import BED_KINDS, CAPABILITY_KINDS

SPECIALTIES: tuple[dict[str, str], ...] = (
    {"code": "CARD", "nameBn": "কার্ডিওলজি", "nameEn": "Cardiology"},
    {"code": "MED", "nameBn": "মেডিসিন", "nameEn": "Medicine"},
    {"code": "GYN", "nameBn": "গাইনী", "nameEn": "Gynaecology"},
    {"code": "ORTHO", "nameBn": "অর্থোপেডিক্স", "nameEn": "Orthopaedics"},
    {"code": "PAED", "nameBn": "শিশু", "nameEn": "Paediatrics"},
    {"code": "NEURO", "nameBn": "নিউরোলজি", "nameEn": "Neurology"},
    {"code": "ENT", "nameBn": "নাক কান গলা", "nameEn": "ENT"},
    {"code": "DERM", "nameBn": "চর্ম ও যৌন", "nameEn": "Dermatology"},
)
SPECIALTY_CODES = tuple(s["code"] for s in SPECIALTIES)


def is_specialty_code(code: str) -> bool:
    return code in SPECIALTY_CODES


def specialty_of(code: str) -> dict[str, str]:
    for entry in SPECIALTIES:
        if entry["code"] == code:
            return entry
    raise ValueError(f"Unknown specialty code: {code}")


SEARCH_CAPABILITIES = ("burn_unit", "cardiac", "cath_lab", "stroke", "dialysis", "trauma_ot", "isolation")
SEARCH_BED_KINDS = ("icu", "ccu", "nicu", "hdu", "cabin", "general", "burn")


def need_key(need: dict[str, str]) -> str:
    if need["kind"] == "specialty":
        return f"specialty:{need['code']}"
    if need["kind"] == "bed":
        return f"bed:{need['bedKind']}"
    return f"capability:{need['capability']}"


def parse_need(key: str) -> dict[str, str] | None:
    at = key.find(":")
    if at == -1:
        return None
    kind, value = key[:at], key[at + 1 :]
    if kind == "specialty":
        return {"kind": "specialty", "code": value} if is_specialty_code(value) else None
    if kind == "bed":
        return {"kind": "bed", "bedKind": value} if value in BED_KINDS else None
    if kind == "capability":
        return {"kind": "capability", "capability": value} if value in CAPABILITY_KINDS else None
    return None


OTHER_NAMES: dict[str, tuple[str, ...]] = {
    "specialty:CARD": ("cardiologist", "heart", "heart doctor", "কার্ডিওলজিস্ট", "হৃদরোগ", "হার্ট"),
    "specialty:MED": ("medicine doctor", "physician", "মেডিসিন ডাক্তার"),
    "specialty:GYN": ("gynae", "gynecology", "gynaecologist", "gynecologist", "গাইনি", "স্ত্রীরোগ"),
    "specialty:ORTHO": ("ortho", "orthopedics", "orthopaedic", "orthopedic", "bone", "অর্থোপেডিক", "হাড়"),
    "specialty:PAED": ("pediatrics", "paediatrician", "pediatrician", "child doctor", "শিশু ডাক্তার"),
    "specialty:NEURO": ("neuro", "neurologist", "নিউরো", "স্নায়ু"),
    "specialty:ENT": ("ear nose throat", "ইএনটি"),
    "specialty:DERM": ("derm", "dermatologist", "skin", "চর্ম", "ত্বক"),
    "bed:icu": ("icu", "intensive care", "আইসিইউ"),
    "bed:ccu": ("ccu", "coronary care", "সিসিইউ"),
    "bed:nicu": ("nicu", "newborn icu", "এনআইসিইউ"),
    "bed:hdu": ("hdu", "high dependency", "এইচডিইউ"),
    "bed:cabin": ("cabin", "কেবিন"),
    "bed:general": ("bed", "beds", "ward", "general bed", "বেড", "শয্যা", "ওয়ার্ড", "সাধারণ বেড"),
    "bed:burn": ("burn bed", "বার্ন বেড"),
    "capability:burn_unit": ("burn", "burn unit", "burns", "বার্ন", "বার্ন ইউনিট", "পোড়া"),
    "capability:cardiac": ("cardiac", "cardiac emergency", "heart attack", "হার্ট অ্যাটাক"),
    "capability:cath_lab": ("cath lab", "cathlab", "angiogram", "ক্যাথ ল্যাব", "এনজিওগ্রাম"),
    "capability:stroke": ("stroke", "stroke unit", "স্ট্রোক"),
    "capability:dialysis": ("dialysis", "ডায়ালাইসিস"),
    "capability:trauma_ot": ("trauma", "trauma ot", "ট্রমা"),
    "capability:isolation": ("isolation", "আইসোলেশন"),
}

_PUNCTUATION = re.compile(r"""[.,;:!?'"()\[\]{}]+""")
_SPACES = re.compile(r"\s+")


def fold_search_text(raw: str) -> str:
    folded = unicodedata.normalize("NFC", raw).lower()
    folded = _PUNCTUATION.sub(" ", folded)
    return _SPACES.sub(" ", folded).strip()


def _build_names() -> list[tuple[dict[str, str], list[str]]]:
    named = []
    for key, others in OTHER_NAMES.items():
        need = parse_need(key)
        if need is None:
            raise ValueError(f"Unknown need in the search names: {key}")
        own = (
            [name for entry in SPECIALTIES if entry["code"] == need["code"] for name in (entry["nameBn"], entry["nameEn"])]
            if need["kind"] == "specialty"
            else []
        )
        named.append((need, [fold_search_text(n) for n in (*own, *others)]))
    return named


_NAMED = _build_names()


def read_search(raw: str | None) -> dict[str, Any]:
    """The need the whole text names, if exactly one, and the text itself."""
    folded = fold_search_text(raw or "")
    if folded == "":
        return {"need": None, "text": None}
    matches = [need for need, names in _NAMED if folded in names]
    return {
        "need": matches[0] if len(matches) == 1 else None,
        "text": unicodedata.normalize("NFC", raw or "").strip(),
    }


def suggest_needs(raw: str, limit: int = 4) -> list[dict[str, str]]:
    folded = fold_search_text(raw)
    if len(folded) < 2:
        return []
    exact, starts, within = [], [], []
    for need, names in _NAMED:
        if folded in names:
            exact.append(need)
        elif any(name.startswith(folded) for name in names):
            starts.append(need)
        elif any(word.startswith(folded) for name in names for word in name.split(" ")):
            within.append(need)
    return [*exact, *starts, *within][:limit]


def tally_of_kind(capacity: dict[str, Any] | None, kind: str) -> dict[str, Any] | None:
    if capacity is None:
        return None
    return next((entry for entry in capacity["byKind"] if entry["kind"] == kind), None)


def confirmed_tally_of_kind(capacity: dict[str, Any] | None, kind: str) -> dict[str, Any] | None:
    tally = tally_of_kind(capacity, kind)
    if tally is None or tally["asOf"] is None:
        return None
    return tally


def order_for_need(listings: list[dict[str, Any]], need: dict[str, str] | None) -> list[dict[str, Any]]:
    """A bed search lists confirmed free beds of that kind first; otherwise unchanged."""
    if need is None or need["kind"] != "bed":
        return listings

    def rank(listing: dict[str, Any]) -> int:
        tally = confirmed_tally_of_kind(listing["beds"], need["bedKind"])
        return -1 if tally is None else tally["free"]

    ranked = [(rank(listing), index, listing) for index, listing in enumerate(listings)]
    ranked.sort(key=lambda item: (-item[0], item[1]))
    return [listing for _, _, listing in ranked]
