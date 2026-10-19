"""Reading a CSV file as a hospital's spreadsheet saves it (port of `imports/csv.ts`; FR-IMP-09).

RFC 4180 with what Excel and LibreOffice actually write: a UTF-8 byte order
mark, CRLF or LF line ends, quoted fields with `""` for a quote, commas and
line breaks inside quotes, a blank last line. No dependency. Pure.
"""

from __future__ import annotations

import re
from typing import Any

from ...core.schema import js_trim


def parse_csv(text: str) -> dict[str, Any] | str:
    """`{header, rows: [{rowNumber, cells}]}`, or `"empty"` / `"unterminated_quote"`."""
    source = text[1:] if text.startswith("﻿") else text
    records: list[list[str]] = []
    record: list[str] = []
    field: list[str] = []
    quoted = False
    index = 0
    length = len(source)
    while index < length:
        char = source[index]
        if quoted:
            if char == '"':
                if index + 1 < length and source[index + 1] == '"':
                    field.append('"')
                    index += 2
                    continue
                quoted = False
                index += 1
                continue
            field.append(char)
            index += 1
            continue
        if char == '"' and not field:
            quoted = True
            index += 1
            continue
        if char == ",":
            record.append("".join(field))
            field = []
            index += 1
            continue
        if char in ("\r", "\n"):
            record.append("".join(field))
            records.append(record)
            record = []
            field = []
            index += 2 if char == "\r" and index + 1 < length and source[index + 1] == "\n" else 1
            continue
        field.append(char)
        index += 1
    if quoted:
        return "unterminated_quote"
    if field or record:
        record.append("".join(field))
        records.append(record)
    # A line with nothing on it is not a row a person meant.
    meaningful = [
        {"rowNumber": position + 1, "cells": cells}
        for position, cells in enumerate(records)
        if any(js_trim(cell) != "" for cell in cells)
    ]
    if not meaningful:
        return "empty"
    first, rest = meaningful[0], meaningful[1:]
    return {"header": [js_trim(cell) for cell in first["cells"]], "rows": rest}


_NEEDS_QUOTES = re.compile(r'[",\r\n]')


def csv_field(value: str) -> str:
    return '"' + value.replace('"', '""') + '"' if _NEEDS_QUOTES.search(value) else value


def csv_line(values: list[str] | tuple[str, ...]) -> str:
    return ",".join(csv_field(value) for value in values)
