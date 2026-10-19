"""Request shapes for importing a hospital's own data (port of `schemas/import.schema.ts`;
S-B-14, BACKEND.md §7.7 `/hospital/imports`, FR-IMP-05..09, FR-IMP-13..20).

The file travels as UTF-8 text inside JSON, at most five megabytes of it.
"""

from __future__ import annotations

from ...core.schema import z
from ..imports.mapping import STRUCTURE_TYPES
from ..imports.sets import IMPORT_SETS

MAX_IMPORT_BYTES = 5 * 1024 * 1024


def import_utf8_bytes(value: str) -> int:
    """Portable UTF-8 size, a lone surrogate counted as its three replacement bytes."""
    total = 0
    for character in value:
        point = ord(character)
        total += 1 if point <= 0x7F else 2 if point <= 0x7FF else 3 if point <= 0xFFFF else 4
    return total


csv_text = (
    z.string()
    .min(1)
    .refine(
        lambda value: import_utf8_bytes(value) <= MAX_IMPORT_BYTES,
        {"message": "CSV exceeds the five-megabyte UTF-8 limit"},
    )
)

import_set_params = z.object({"set": z.enum(list(IMPORT_SETS))})
import_params = z.object({"id": z.string().uuid()})

import_upload_body = z.strict_object(
    {"set": z.enum(list(IMPORT_SETS)), "fileName": z.string().trim().min(1).max(200), "csv": csv_text}
)

structure_type = z.enum(list(STRUCTURE_TYPES))

import_analyse_body = z.strict_object(
    {"set": z.enum(list(IMPORT_SETS)), "csv": csv_text, "rowType": structure_type.optional()}
)

column_mapping = z.strict_object(
    {
        "rowType": structure_type.nullable(),
        "fields": z.record(z.string().regex(r"^[a-z][a-z_]{1,30}$"), z.number().int().min(0).max(500).nullable()),
    }
)

import_mapped_body = z.strict_object(
    {
        "set": z.enum(list(IMPORT_SETS)),
        "fileName": z.string().trim().min(1).max(200),
        "csv": csv_text,
        "mapping": column_mapping,
        "suggestedByModel": z.array(z.string().regex(r"^[a-z][a-z_]{1,30}$")).max(40).optional(),
    }
)
