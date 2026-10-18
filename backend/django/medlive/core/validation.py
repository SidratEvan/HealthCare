"""Request validation (port of `middleware/validate.ts`).

Validates and *replaces* `params`, `query` and `body`: after this step a
handler sees parsed, coerced, stripped data, and an unexpected field cannot
reach a repository. Every problem is reported at once, as
`VALIDATION_FAILED` with `details.issues = [{path, message}]` where the path
starts with `params.`, `query.` or `body.`.

`FR-DEM-08`: a demonstration's refusal of a person's phone is its own answer,
`DEMO_PHONE_NOT_ALLOWED` with `details.fields`, so a screen can say what to do.
"""

from __future__ import annotations

from typing import Any, Iterable

from ..domain.demo_phones import DEMO_PHONE_NOT_ALLOWED
from .errors import AppError, validation_failed
from .http import ApiRequest
from .schema import UNDEFINED, ParseError, Schema


class DemoPhoneRefused(Exception):
    """A schema parsed outside `validate` refused a person's phone (FR-DEM-08)."""


def refused_phone_paths(issues: Iterable[dict[str, Any]], prefix: list[str] | None = None) -> list[str]:
    """Where a parse refused a phone under the demonstration's rule, as `a.b.c`."""
    paths: list[str] = []
    for issue in issues:
        at = [*(prefix or []), *(str(part) for part in issue.get("path", []))]
        if issue.get("message") == DEMO_PHONE_NOT_ALLOWED:
            paths.append(".".join(at))
        for branch in issue.get("errors", []) or []:
            if isinstance(branch, list):
                paths.extend(refused_phone_paths(branch, at))
    return paths


def _collect(issues: Iterable[dict[str, Any]], source: str) -> list[dict[str, str]]:
    return [
        {"path": ".".join([source, *(str(part) for part in issue["path"])]), "message": issue["message"]}
        for issue in issues
    ]


def validate(
    *,
    params: Schema | None = None,
    query: Schema | None = None,
    body: Schema | None = None,
):  # type: ignore[no-untyped-def]
    """A route step: `validate(params=session_params, body=call_next_body)`."""

    def step(req: ApiRequest) -> None:
        issues: list[dict[str, str]] = []
        refused: list[str] = []
        for source, schema in (("params", params), ("query", query), ("body", body)):
            if schema is None:
                continue
            raw = getattr(req, source)
            value = UNDEFINED if raw is None and source == "body" else raw
            result = schema.safe_parse(value)
            if result.success:
                setattr(req, source, result.data)
            else:
                issues.extend(_collect(result.issues, source))
                refused.extend(refused_phone_paths(result.issues, [source]))
        if refused:
            raise AppError("DEMO_PHONE_NOT_ALLOWED", details={"fields": refused})
        if issues:
            raise validation_failed({"issues": issues})

    return step


def parse_or_raise(schema: Schema, value: Any) -> Any:
    """`schema.parse(value)` for a service, answered as a demonstration's refusal
    when that is what failed (`asAppError`'s branch for it)."""
    try:
        return schema.parse(value)
    except ParseError as error:
        if refused_phone_paths(error.issues):
            raise DemoPhoneRefused() from error
        raise
