"""The part of `@platform/i18n` the server uses (numerals, clock, money, message bodies).

The server never sends prose for a screen (I18N-03); it does write SMS bodies,
which are in the recipient's language with Bengali numerals for Bangla
(`FR-NOT-04`, `TYP-04`). Held to the TypeScript by `tests/parity/test_i18n_parity.py`.
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Mapping

BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯"

DHAKA_OFFSET = timedelta(hours=6)

DAY_PERIODS = (
    (6, 12, "সকাল", "morning"),
    (12, 15, "দুপুর", "midday"),
    (15, 18, "বিকাল", "afternoon"),
    (18, 20, "সন্ধ্যা", "evening"),
)
NIGHT_BN = "রাত"

BED_KIND_NAMES: dict[str, dict[str, str]] = {
    "general": {"bn": "সাধারণ", "en": "General"},
    "cabin": {"bn": "কেবিন", "en": "Cabin"},
    "hdu": {"bn": "এইচডিইউ", "en": "HDU"},
    "icu": {"bn": "আইসিইউ", "en": "ICU"},
    "ccu": {"bn": "সিসিইউ", "en": "CCU"},
    "nicu": {"bn": "এনআইসিইউ", "en": "NICU"},
    "isolation": {"bn": "আইসোলেশন", "en": "Isolation"},
    "burn": {"bn": "বার্ন", "en": "Burn"},
}

#: The patient-app copy keys the server uses (`tp` in `messages.ts`).
MESSAGES: dict[str, dict[str, str]] = {
    "etaUnknown": {"bn": "এখনো বলা যাচ্ছে না", "en": "Not known yet"},
    "mockPayTitle": {"bn": "সিমুলেটেড পেমেন্ট (ডেমো)", "en": "Simulated payment (demo)"},
    "mockPayNote": {
        "bn": "এটি bKash বা Nagad নয়। কোনো টাকা কাটা হবে না; ফলাফল বেছে নিন।",
        "en": "This is not bKash or Nagad. No money moves; choose an outcome.",
    },
    "mockPayAmount": {"bn": "পরিমাণ", "en": "Amount"},
    "mockPayPay": {"bn": "পরিশোধ সফল", "en": "Payment succeeds"},
    "mockPayFail": {"bn": "পরিশোধ ব্যর্থ", "en": "Payment fails"},
    "mockPayCancel": {"bn": "বাতিল করুন", "en": "Cancel"},
    "mockPayDone": {
        "bn": "এই পেমেন্টের ফলাফল আগেই বেছে নেওয়া হয়েছে।",
        "en": "This payment already has an outcome.",
    },
}


def tp(key: str, locale: str) -> str:
    return MESSAGES[key][locale]


def bed_kind_name(kind: str, locale: str) -> str:
    return BED_KIND_NAMES[kind][locale]


def to_bengali_digits(value: str) -> str:
    return re.sub(r"[0-9]", lambda m: BENGALI_DIGITS[int(m.group(0))], value)


def to_latin_digits(value: str) -> str:
    return re.sub("[০-৯]", lambda m: str(BENGALI_DIGITS.index(m.group(0))), value)


def has_bengali_digits(value: str) -> bool:
    return re.search("[০-৯]", value) is not None


def _group(digits: str, indian: bool) -> str:
    if len(digits) <= 3:
        return digits
    if not indian:
        groups = []
        while len(digits) > 3:
            groups.insert(0, digits[-3:])
            digits = digits[:-3]
        return ",".join([digits, *groups])
    head, tail = digits[:-3], digits[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    return ",".join([part for part in [head, *groups] if part] + [tail])


def format_number(
    value: float, style: str, *, minimum_fraction_digits: int = 0, maximum_fraction_digits: int | None = None
) -> str:
    """`Intl.NumberFormat(bn-BD | en-US)`, with the digits made one script.

    bn-BD groups the Indian way (১২,৩৪,৫৬৭); en-US by thousands. Rounding is
    half away from zero, as Intl's is.
    """
    if maximum_fraction_digits is None:
        maximum_fraction_digits = max(3, minimum_fraction_digits)
    if isinstance(value, float) and math.isnan(value):
        text = "NaN"
    elif isinstance(value, float) and math.isinf(value):
        text = "∞" if value > 0 else "-∞"
    else:
        quantum = Decimal(1).scaleb(-maximum_fraction_digits)
        rounded = Decimal(repr(value) if isinstance(value, float) else str(value)).quantize(quantum, rounding=ROUND_HALF_UP)
        negative = rounded < 0
        rounded = abs(rounded)
        whole, _, fraction = f"{rounded:f}".partition(".")
        fraction = fraction.rstrip("0")
        if len(fraction) < minimum_fraction_digits:
            fraction = fraction + "0" * (minimum_fraction_digits - len(fraction))
        text = _group(whole, indian=style == "bengali") + (f".{fraction}" if fraction else "")
        if negative and (whole != "0" or fraction.strip("0")):
            text = "-" + text
    return to_bengali_digits(text) if style == "bengali" else to_latin_digits(text)


def format_serial(serial: int, style: str) -> str:
    return to_bengali_digits(str(serial)) if style == "bengali" else str(serial)


def format_taka(poisha: int, style: str) -> str:
    if not isinstance(poisha, int) or isinstance(poisha, bool):
        raise ValueError(f"Money is integer poisha (DB-P5); got {poisha}.")
    whole = poisha % 100 == 0
    formatted = format_number(
        poisha / 100,
        style,
        minimum_fraction_digits=0 if whole else 2,
        maximum_fraction_digits=2,
    )
    return f"৳{formatted}"


def format_minutes(minutes: float, style: str) -> str:
    return format_number(max(0, math.floor(minutes + 0.5)), style)


def day_period(hour24: int) -> str:
    for start, end, bn, _en in DAY_PERIODS:
        if start <= hour24 < end:
            return bn
    return NIGHT_BN


def _to12(hour24: int) -> int:
    hour = hour24 % 12
    return 12 if hour == 0 else hour


def _parse(iso: str) -> datetime | None:
    from .domain.time import parse_ms

    ms = parse_ms(iso)
    if ms != ms:
        return None
    return datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(milliseconds=ms)


def format_clock(iso: str, style: str) -> str:
    """`সকাল ১০:৩০` for Bangla, `10:30 AM` for English, in Dhaka's time."""
    at = _parse(iso)
    if at is None:
        return ""
    local = at + DHAKA_OFFSET
    hour24 = local.hour
    minute = f"{local.minute:02d}"
    if style == "latin":
        suffix = "AM" if hour24 < 12 else "PM"
        return f"{_to12(hour24)}:{minute} {suffix}"
    return f"{day_period(hour24)} {to_bengali_digits(f'{_to12(hour24)}:{minute}')}"


_PLACEHOLDER = re.compile(r"\{([a-z][a-zA-Z0-9]*)\}")


def render(body: str, params: Mapping[str, str]) -> str:
    """Fills placeholders; a missing parameter stays visible (`{serial}`), loudly."""
    return _PLACEHOLDER.sub(lambda m: params[m.group(1)] if m.group(1) in params else m.group(0), body)


def numerals_for(locale: str) -> str:
    return "bengali" if locale == "bn" else "latin"


def local_name(locale: str, bn: str, en: str | None) -> str:
    if locale == "en" and en is not None and en.strip() != "":
        return en
    return bn


#: What each test in the demo catalogue is called (`shared/i18n/src/lab.ts`; FR-LAB-01).
LAB_TEST_NAMES: dict[str, dict[str, str]] = {
    "CBC": {"bn": "সম্পূর্ণ রক্ত পরীক্ষা (CBC)", "en": "Complete blood count (CBC)"},
    "BLOOD-SUGAR": {"bn": "রক্তে শর্করা (FBS)", "en": "Blood sugar (FBS)"},
    "LIPID-PROFILE": {"bn": "লিপিড প্রোফাইল", "en": "Lipid profile"},
    "SERUM-CREATININE": {"bn": "সিরাম ক্রিয়েটিনিন", "en": "Serum creatinine"},
    "LFT": {"bn": "লিভার ফাংশন টেস্ট", "en": "Liver function test"},
    "TSH": {"bn": "থাইরয়েড (TSH)", "en": "Thyroid (TSH)"},
    "URINE-RE": {"bn": "প্রস্রাব পরীক্ষা (R/E)", "en": "Urine test (R/E)"},
    "XR-CHEST": {"bn": "বুকের এক্স-রে", "en": "Chest X-ray"},
    "ECG": {"bn": "ইসিজি", "en": "ECG"},
    "ECHO": {"bn": "ইকোকার্ডিওগ্রাম", "en": "Echocardiogram"},
    "USG-ABDOMEN": {"bn": "পেটের আলট্রাসনোগ্রাম", "en": "Abdominal ultrasound"},
    "HBA1C": {"bn": "HbA1c", "en": "HbA1c"},
}


def is_lab_test_code(code: str) -> bool:
    return code in LAB_TEST_NAMES


def lab_test_name(code: str, locale: str, stored: str) -> str:
    """A test's name in the language being read, or the stored name if unknown."""
    return LAB_TEST_NAMES[code][locale] if code in LAB_TEST_NAMES else stored
