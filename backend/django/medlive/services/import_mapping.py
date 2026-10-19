"""Mapping a hospital's own export onto the import template
(port of `services/importMapping.service.ts`; PRD.md §14b, FR-IMP-13..20, S-B-14).

`analyse` reads a file and proposes, and writes nothing. `confirm` takes the
mapping a person confirmed, rewrites the file into the template's shape and
hands it to the existing check, which decides what is importable. A saved
mapping is found by a hash of the folded headings, so the same export maps
itself next time (FR-IMP-20); it stores headings' positions, never a cell.
"""

from __future__ import annotations

import hashlib
from typing import Any

from ..adapters.mapping import propose_safely
from ..core.errors import AppError
from ..domain.imports.csv import parse_csv
from ..domain.imports.mapping import (
    apply_mapping,
    guess_structure_type,
    has_template_header,
    header_looks_like_data,
    header_signature,
    mapping_problems,
    model_mapping_request,
    profile_columns,
    propose_mapping,
    target_fields,
    target_of,
    target_one_of,
    unmapped_columns,
    with_model_suggestions,
)
from ..repositories import imports as repo
from .imports import MAX_IMPORT_ROWS, check, node_utf8, sha256_of_text


def _refused(reason: str, extra: dict[str, Any] | None = None) -> AppError:
    return AppError("IMPORT_FILE", details={"reason": reason, **(extra or {})})


def _read_file(csv: str) -> dict[str, Any]:
    table = parse_csv(csv)
    if not isinstance(table, dict):
        raise _refused(table)
    if len(table["rows"]) > MAX_IMPORT_ROWS:
        raise _refused("too_many_rows", {"max": MAX_IMPORT_ROWS})
    return table


def _header_hash(table: dict[str, Any]) -> str:
    return hashlib.sha256(node_utf8(header_signature(table["header"]))).hexdigest()


def _proposals_from_saved(saved: dict[str, Any], fields: list[dict[str, Any]], column_count: int) -> list[dict[str, Any]]:
    proposals: list[dict[str, Any]] = []
    for entry in fields:
        field = entry["field"]
        column = saved["mapping"].get(field)
        if column is None or column >= column_count:
            proposals.append({"field": field, "column": None, "confidence": None, "source": None, "reason": None})
        else:
            proposals.append({"field": field, "column": column, "confidence": 1, "source": "saved", "reason": None})
    return proposals


def _empty_analysis(**overrides: Any) -> dict[str, Any]:
    return {
        "templateShaped": False,
        "rowCount": 0,
        "columns": [],
        "rowType": None,
        "needsRowType": False,
        "fields": [],
        "oneOf": [],
        "proposal": [],
        "fromSaved": False,
        "model": "not_asked",
        **overrides,
    }


def analyse(actor: dict[str, Any], *, set_kind: str, csv: str, row_type: str | None = None) -> dict[str, Any]:
    """Reads a file and proposes a mapping (FR-IMP-13..15). Writes nothing."""
    table = _read_file(csv)
    row_count = len(table["rows"])
    if has_template_header(set_kind, table["header"]):
        return _empty_analysis(templateShaped=True, rowCount=row_count)

    # FR-IMP-14: a first row that is a patient is not a row of headings.
    if header_looks_like_data(table["header"]):
        raise _refused("no_header_row")

    columns = profile_columns(table)
    saved = repo.find_mapping_profile(hospital_id=actor["hospitalId"], set_kind=set_kind, header_sha256=_header_hash(table))

    chosen_type = None
    if set_kind == "structure":
        chosen_type = row_type or (saved["rowType"] if saved is not None else None) or guess_structure_type(columns)

    target = target_of(set_kind, chosen_type)
    if target is None:
        return _empty_analysis(rowCount=row_count, columns=columns, needsRowType=True)

    fields = [{"field": field["field"], "required": field["required"]} for field in target_fields(target)]
    # A saved mapping is offered only for the kind of row it was confirmed for.
    if saved is not None and saved["rowType"] == chosen_type:
        return _empty_analysis(
            rowCount=row_count,
            columns=columns,
            rowType=chosen_type,
            fields=fields,
            oneOf=target_one_of(target),
            proposal=_proposals_from_saved(saved, fields, len(columns)),
            fromSaved=True,
        )

    # Rules first. A model is asked only about what they left open, and only
    # with headings and profiles (FR-IMP-17).
    rules = propose_mapping(target, columns)
    asked = model_mapping_request(target, columns, rules)
    proposal = rules
    model = "not_asked"
    if asked is not None:
        answer = propose_safely(asked)
        if answer.get("kind") == "suggestions":
            # Untrusted: kept only where it names a field asked about and a column offered.
            proposal = with_model_suggestions(rules, asked, answer.get("suggestions") or [])
            model = "used" if any(entry["source"] == "model" for entry in proposal) else "nothing"
        elif answer.get("reason") != "off":
            model = "unavailable"

    return _empty_analysis(
        rowCount=row_count,
        columns=columns,
        rowType=chosen_type,
        fields=fields,
        oneOf=target_one_of(target),
        proposal=proposal,
        model=model,
    )


def _sources_of(
    *, mapping: dict[str, Any], rules: list[dict[str, Any]], saved: dict[str, Any] | None, suggested_by_model: list[str]
) -> dict[str, str]:
    sources: dict[str, str] = {}
    by_model = set(suggested_by_model)
    for field, column in mapping["fields"].items():
        if column is None:
            continue
        rule = next((proposal for proposal in rules if proposal["field"] == field), None)
        if saved is not None and saved["mapping"].get(field) == column:
            sources[field] = "saved"
        elif rule is not None and rule["column"] == column:
            sources[field] = "rule"
        elif field in by_model:
            # Believed only when no rule and no saved mapping accounts for the
            # same choice; it changes nothing but this word on the audit row.
            sources[field] = "model"
        else:
            sources[field] = "manual"
    return sources


def confirm(
    actor: dict[str, Any],
    *,
    set_kind: str,
    file_name: str,
    csv: str,
    mapping: dict[str, Any],
    suggested_by_model: list[str] | None = None,
) -> dict[str, Any]:
    """Takes a confirmed mapping to the existing check (FR-IMP-18..20)."""
    table = _read_file(csv)
    if header_looks_like_data(table["header"]):
        raise _refused("no_header_row")
    problems = mapping_problems(set_kind, mapping, len(table["header"]))
    if problems:
        raise _refused("mapping_invalid", {"problems": problems})
    target = target_of(set_kind, mapping["rowType"])
    if target is None:
        raise _refused("mapping_invalid", {"problems": [{"kind": "row_type_required"}]})

    columns = profile_columns(table)
    header_sha256 = _header_hash(table)
    saved = repo.find_mapping_profile(hospital_id=actor["hospitalId"], set_kind=set_kind, header_sha256=header_sha256)
    sources = _sources_of(
        mapping=mapping,
        rules=propose_mapping(target, columns),
        saved=saved if saved is not None and saved["rowType"] == mapping["rowType"] else None,
        suggested_by_model=suggested_by_model or [],
    )

    # The existing importer, unchanged; the batch carries the given file's fingerprint.
    batch = check(
        actor,
        set_kind=set_kind,
        file_name=file_name,
        csv=apply_mapping(set_kind, table, mapping),
        file_sha256=sha256_of_text(csv),
    )

    # Only what a mapping is: which heading feeds which field. No cell value.
    by_index = {column["index"]: column for column in columns}
    chosen = {
        field: {"heading": by_index[column]["name"] if column in by_index else "", "source": sources.get(field, "manual")}
        for field, column in mapping["fields"].items()
        if column is not None
    }
    repo.save_mapping_profile(
        hospital_id=actor["hospitalId"],
        set_kind=set_kind,
        header_sha256=header_sha256,
        row_type=mapping["rowType"],
        mapping=mapping["fields"],
        sources=sources,
        approved_by=actor["staffId"],
        audit_ip=actor["ip"],
        audit_user_agent=actor["userAgent"],
        audit_batch_id=batch["id"],
        audit_fields=chosen,
        audit_not_imported=[column["name"] for column in unmapped_columns(mapping, columns)],
    )
    return batch
