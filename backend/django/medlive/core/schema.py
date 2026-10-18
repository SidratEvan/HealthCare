"""A zod-compatible validator, so the shared schemas port line for line.

The TypeScript API validates every request with zod schemas that the browser
apps share (`shared/domain/src/schemas`). Pydantic's rules differ from zod's
in ways a client can see: it coerces `"5"` to `5`, a Python `bool` is an
`int`, zod 4's `uuid()` checks the version and variant bits, and "absent" is
not "null". So this module reproduces the part of zod the codebase uses, with
zod 4's semantics and messages, and a schema reads the same in both:

    zod:     z.string().trim().min(1).max(200).nullable().default(null)
    python:  z.string().trim().min(1).max(200).nullable().default(None)

A parse gives back JSON-shaped data (dicts with the schema's own keys; a key
whose value is "undefined" is absent) or a list of issues, each
`{"code", "path", "message", ...}` exactly as zod reports them.

Semantics kept from zod 4, because they decide what a client is told:

- `z.object` strips unknown keys; `z.strict_object` refuses them.
- A type failure aborts its branch; a size or format check does not, so
  every problem with a form is reported at once.
- An object's `refine` runs only when nothing under it aborted; a
  `transform` runs only on a value with no issues at all.
- `default` applies to an absent value (and is not itself parsed);
  `optional` lets an absent value stay absent; `nullable` admits `null`.
- `z.coerce.number()` is JavaScript's `Number(value)`.
"""

from __future__ import annotations

import inspect
import math
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable, Iterable, Mapping, Sequence
from urllib.parse import urlsplit


class _Undefined:
    """JavaScript's `undefined`: an absent key, or nothing given."""

    _instance: "_Undefined | None" = None

    def __new__(cls) -> "_Undefined":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        return "undefined"

    def __bool__(self) -> bool:
        return False


UNDEFINED: Any = _Undefined()

MAX_SAFE_INTEGER = 9_007_199_254_740_991


# ---------------------------------------------------------------------------
# Issues and results
# ---------------------------------------------------------------------------


@dataclass
class Ctx:
    issues: list[dict[str, Any]] = field(default_factory=list)

    def add(self, issue: dict[str, Any], *, fatal: bool) -> None:
        issue = dict(issue)
        issue["_fatal"] = fatal
        self.issues.append(issue)


def _received(value: Any) -> str:
    if value is UNDEFINED:
        return "undefined"
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "NaN" if isinstance(value, float) and math.isnan(value) else "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def _type_issue(ctx: Ctx, path: list[Any], expected: str, value: Any) -> None:
    ctx.add(
        {
            "expected": expected,
            "code": "invalid_type",
            "path": path,
            "message": f"Invalid input: expected {expected}, received {_received(value)}",
        },
        fatal=True,
    )


def _public(issue: dict[str, Any]) -> dict[str, Any]:
    out = {key: value for key, value in issue.items() if key != "_fatal"}
    if "errors" in out:
        out["errors"] = [[_public(inner) for inner in branch] for branch in out["errors"]]
    return out


class ParseError(Exception):
    """A failed `parse`, carrying zod-shaped issues."""

    def __init__(self, issues: list[dict[str, Any]]) -> None:
        super().__init__("; ".join(f"{'.'.join(map(str, i['path']))}: {i['message']}" for i in issues))
        self.issues = issues


@dataclass(frozen=True)
class Result:
    success: bool
    data: Any = None
    issues: tuple[dict[str, Any], ...] = ()


def _aborted(ctx: Ctx, since: int) -> bool:
    return any(issue["_fatal"] for issue in ctx.issues[since:])


# ---------------------------------------------------------------------------
# The base schema and its wrappers
# ---------------------------------------------------------------------------


class Schema:
    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        raise NotImplementedError

    # Public API -------------------------------------------------------------

    def safe_parse(self, value: Any) -> Result:
        ctx = Ctx()
        data = self._parse(value, [], ctx)
        if ctx.issues:
            return Result(False, None, tuple(_public(issue) for issue in ctx.issues))
        return Result(True, data)

    def parse(self, value: Any) -> Any:
        result = self.safe_parse(value)
        if not result.success:
            raise ParseError(list(result.issues))
        return result.data

    # Wrappers ---------------------------------------------------------------

    def optional(self) -> "Schema":
        return _Optional(self)

    def nullable(self) -> "Schema":
        return _Nullable(self)

    def nullish(self) -> "Schema":
        return _Optional(_Nullable(self))

    def default(self, value: Any) -> "Schema":
        return _Default(self, value)

    def catch(self, value: Any) -> "Schema":
        return _Catch(self, value)

    def transform(self, fn: Callable[[Any], Any]) -> "Schema":
        return _Transform(self, fn)

    def pipe(self, other: "Schema") -> "Schema":
        return _Pipe(self, other)

    def refine(
        self,
        check: Callable[[Any], bool],
        message: str | Mapping[str, Any] = "Invalid input",
        *,
        path: Sequence[Any] | None = None,
    ) -> "Schema":
        if isinstance(message, Mapping):
            path = message.get("path", path)
            message = str(message.get("message", "Invalid input"))
        return _Refine(self, check, message, list(path or []))

    def super_refine(self, fn: Callable[[Any, "RefineCtx"], None]) -> "Schema":
        return _SuperRefine(self, fn)

    def array(self) -> "ArraySchema":
        return ArraySchema(self)


class _Optional(Schema):
    def __init__(self, inner: Schema) -> None:
        self.inner = inner

    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        if value is UNDEFINED:
            return UNDEFINED
        return self.inner._parse(value, path, ctx)

    def unwrap(self) -> Schema:
        return self.inner


class _Nullable(Schema):
    def __init__(self, inner: Schema) -> None:
        self.inner = inner

    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        if value is None:
            return None
        return self.inner._parse(value, path, ctx)


class _Default(Schema):
    def __init__(self, inner: Schema, value: Any) -> None:
        self.inner = inner
        self.value = value

    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        if value is UNDEFINED:
            return self.value() if callable(self.value) else self.value
        return self.inner._parse(value, path, ctx)


class _Catch(Schema):
    def __init__(self, inner: Schema, value: Any) -> None:
        self.inner = inner
        self.value = value

    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        own = Ctx()
        out = self.inner._parse(value, path, own)
        if own.issues:
            return self.value() if callable(self.value) else self.value
        return out


class _Transform(Schema):
    def __init__(self, inner: Schema, fn: Callable[[Any], Any]) -> None:
        self.inner = inner
        self.fn = fn

    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        since = len(ctx.issues)
        out = self.inner._parse(value, path, ctx)
        if len(ctx.issues) > since:
            # zod: a transform never runs on a value with issues, and what
            # follows it sees an aborted value.
            for issue in ctx.issues[since:]:
                issue["_fatal"] = True
            return out
        try:
            return _call_transform(self.fn, out, path, ctx)
        except _TransformIssue:
            return UNDEFINED


class _TransformIssue(Exception):
    pass


class TransformCtx:
    def __init__(self, path: list[Any], ctx: Ctx) -> None:
        self._path = path
        self._ctx = ctx

    def add_issue(self, message: str, path: Sequence[Any] = ()) -> None:
        self._ctx.add(
            {"code": "custom", "path": [*self._path, *path], "message": message}, fatal=True
        )


NEVER = object()


def _call_transform(fn: Callable[..., Any], value: Any, path: list[Any], ctx: Ctx) -> Any:
    """Calls `fn(value)`, or `fn(value, ctx)` when it takes a context (zod's
    `transform((value, ctx) => ...)`, which may add an issue and return NEVER)."""
    if _arity(fn) >= 2:
        out = fn(value, TransformCtx(path, ctx))
    else:
        out = fn(value)
    if out is NEVER:
        raise _TransformIssue()
    return out


def _arity(fn: Callable[..., Any]) -> int:
    try:
        parameters = inspect.signature(fn).parameters.values()
    except (TypeError, ValueError):
        return 1
    return sum(
        1 for p in parameters if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)
    )


class _Pipe(Schema):
    def __init__(self, left: Schema, right: Schema) -> None:
        self.left = left
        self.right = right

    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        since = len(ctx.issues)
        out = self.left._parse(value, path, ctx)
        if len(ctx.issues) > since:
            return out
        return self.right._parse(out, path, ctx)


class _Refine(Schema):
    def __init__(self, inner: Schema, check: Callable[[Any], bool], message: str, path: list[Any]) -> None:
        self.inner = inner
        self.check = check
        self.message = message
        self.path = path

    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        since = len(ctx.issues)
        out = self.inner._parse(value, path, ctx)
        if _aborted(ctx, since):
            return out
        if not self.check(out):
            ctx.add({"code": "custom", "path": [*path, *self.path], "message": self.message}, fatal=False)
        return out

    # Object helpers pass through a refine, as zod's do on the inner object.
    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)


class RefineCtx:
    def __init__(self, path: list[Any], ctx: Ctx) -> None:
        self._path = path
        self._ctx = ctx

    def add_issue(self, message: str, path: Sequence[Any] = (), code: str = "custom", **extra: Any) -> None:
        self._ctx.add(
            {"code": code, "path": [*self._path, *path], "message": message, **extra}, fatal=False
        )


class _SuperRefine(Schema):
    def __init__(self, inner: Schema, fn: Callable[[Any, RefineCtx], None]) -> None:
        self.inner = inner
        self.fn = fn

    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        since = len(ctx.issues)
        out = self.inner._parse(value, path, ctx)
        if _aborted(ctx, since):
            return out
        self.fn(out, RefineCtx(path, ctx))
        return out

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)


# ---------------------------------------------------------------------------
# Strings
# ---------------------------------------------------------------------------

# zod 4's own patterns, ASCII-only like JavaScript's `\d`.
_UUID = re.compile(
    r"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}"
    r"|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
)
_GUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_EMAIL = re.compile(
    r"^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$"
)
_DATE = (
    r"(?:(?:[0-9][0-9][2468][048]|[0-9][0-9][13579][26]|[0-9][0-9]0[48]|[02468][048]00|[13579][26]00)-02-29"
    r"|[0-9]{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12][0-9]|3[01])|(?:0[469]|11)-(?:0[1-9]|[12][0-9]|30)"
    r"|(?:02)-(?:0[1-9]|1[0-9]|2[0-8])))"
)
_TIME = r"(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]+)?"
_ISO_DATE = re.compile(f"^{_DATE}$")
_ISO_DATETIME_Z = re.compile(f"^{_DATE}T{_TIME}(?:Z)$")
_ISO_DATETIME_OFFSET = re.compile(f"^{_DATE}T{_TIME}(?:Z|([+-](?:[01][0-9]|2[0-3]):[0-5][0-9]))$")

# JavaScript's `String.prototype.trim()` whitespace.
_JS_WHITESPACE = (
    " \t\n\v\f\r           "
    "      　﻿"
)


def js_trim(value: str) -> str:
    return value.strip(_JS_WHITESPACE)


def js_length(value: str) -> int:
    """`string.length`: UTF-16 code units, as zod measures."""
    return len(value.encode("utf-16-le")) // 2


class StringSchema(Schema):
    def __init__(self) -> None:
        self.ops: list[tuple[str, Any]] = []

    def _with(self, op: str, arg: Any = None) -> "StringSchema":
        clone = StringSchema()
        clone.ops = [*self.ops, (op, arg)]
        return clone

    def min(self, n: int, message: str | None = None) -> "StringSchema":
        return self._with("min", (n, message))

    def max(self, n: int, message: str | None = None) -> "StringSchema":
        return self._with("max", (n, message))

    def length(self, n: int, message: str | None = None) -> "StringSchema":
        return self._with("length", (n, message))

    def nonempty(self, message: str | None = None) -> "StringSchema":
        return self.min(1, message)

    def trim(self) -> "StringSchema":
        return self._with("trim")

    def to_lower_case(self) -> "StringSchema":
        return self._with("lower")

    def to_upper_case(self) -> "StringSchema":
        return self._with("upper")

    def normalize(self, form: str = "NFC") -> "StringSchema":
        return self._with("normalize", form)

    def regex(self, pattern: "re.Pattern[str] | str", message: str | None = None, js: str | None = None) -> "StringSchema":
        r"""A JavaScript regular expression, matched as JavaScript matches it.

        Given as source text, it is compiled with `re.ASCII` (JavaScript's `\d`
        and `\w` are ASCII; Python's are not) and a closing `$` becomes `\Z`
        (Python's `$` also matches before a trailing newline). The message
        shows the source as written, as zod's does.
        """
        if isinstance(pattern, str):
            shown = js if js is not None else f"/{pattern}/"
            source = pattern[:-1] + r"\Z" if pattern.endswith("$") and not pattern.endswith(r"\$") else pattern
            compiled = re.compile(source, re.ASCII)
            return self._with("regex", (compiled, message, shown))
        return self._with("regex", (pattern, message, js))

    def starts_with(self, prefix: str, message: str | None = None) -> "StringSchema":
        return self._with("starts_with", (prefix, message))

    def ends_with(self, suffix: str, message: str | None = None) -> "StringSchema":
        return self._with("ends_with", (suffix, message))

    def includes(self, part: str, message: str | None = None) -> "StringSchema":
        return self._with("includes", (part, message))

    def uuid(self, message: str | None = None) -> "StringSchema":
        return self._with("uuid", message)

    def guid(self, message: str | None = None) -> "StringSchema":
        return self._with("guid", message)

    def email(self, message: str | None = None) -> "StringSchema":
        return self._with("email", message)

    def url(self, message: str | None = None) -> "StringSchema":
        return self._with("url", message)

    def datetime(self, *, offset: bool = False, message: str | None = None) -> "StringSchema":
        return self._with("datetime", (offset, message))

    def date(self, message: str | None = None) -> "StringSchema":
        return self._with("date", message)

    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        if not isinstance(value, str):
            _type_issue(ctx, path, "string", value)
            return value
        out = value
        for op, arg in self.ops:
            if op == "trim":
                out = js_trim(out)
            elif op == "lower":
                out = out.lower()
            elif op == "upper":
                out = out.upper()
            elif op == "normalize":
                out = unicodedata.normalize(arg, out)
            elif op == "min":
                n, message = arg
                if js_length(out) < n:
                    ctx.add(
                        {
                            "origin": "string",
                            "code": "too_small",
                            "minimum": n,
                            "inclusive": True,
                            "path": path,
                            "message": message or f"Too small: expected string to have >={n} characters",
                        },
                        fatal=False,
                    )
            elif op == "max":
                n, message = arg
                if js_length(out) > n:
                    ctx.add(
                        {
                            "origin": "string",
                            "code": "too_big",
                            "maximum": n,
                            "inclusive": True,
                            "path": path,
                            "message": message or f"Too big: expected string to have <={n} characters",
                        },
                        fatal=False,
                    )
            elif op == "length":
                n, message = arg
                size = js_length(out)
                if size != n:
                    code = "too_big" if size > n else "too_small"
                    ctx.add(
                        {
                            "origin": "string",
                            "code": code,
                            "path": path,
                            "message": message
                            or (
                                f"Too big: expected string to have exactly {n} characters"
                                if size > n
                                else f"Too small: expected string to have exactly {n} characters"
                            ),
                        },
                        fatal=False,
                    )
            elif op == "regex":
                compiled, message, js = arg
                if compiled.search(out) is None:
                    shown = js or f"/{compiled.pattern}/"
                    self._format(ctx, path, "regex", message or f"Invalid string: must match pattern {shown}")
            elif op == "starts_with":
                prefix, message = arg
                if not out.startswith(prefix):
                    self._format(ctx, path, "starts_with", message or f'Invalid string: must start with "{prefix}"')
            elif op == "ends_with":
                suffix, message = arg
                if not out.endswith(suffix):
                    self._format(ctx, path, "ends_with", message or f'Invalid string: must end with "{suffix}"')
            elif op == "includes":
                part, message = arg
                if part not in out:
                    self._format(ctx, path, "includes", message or f'Invalid string: must include "{part}"')
            elif op == "uuid":
                if _UUID.fullmatch(out) is None:
                    self._format(ctx, path, "uuid", arg or "Invalid UUID")
            elif op == "guid":
                if _GUID.fullmatch(out) is None:
                    self._format(ctx, path, "guid", arg or "Invalid GUID")
            elif op == "email":
                if _EMAIL.fullmatch(out) is None:
                    self._format(ctx, path, "email", arg or "Invalid email address")
            elif op == "url":
                if not _is_url(out):
                    self._format(ctx, path, "url", arg or "Invalid URL")
            elif op == "datetime":
                offset, message = arg
                pattern = _ISO_DATETIME_OFFSET if offset else _ISO_DATETIME_Z
                if pattern.fullmatch(out) is None:
                    self._format(ctx, path, "datetime", message or "Invalid ISO datetime")
            elif op == "date":
                if _ISO_DATE.fullmatch(out) is None:
                    self._format(ctx, path, "date", arg or "Invalid ISO date")
        return out

    @staticmethod
    def _format(ctx: Ctx, path: list[Any], fmt: str, message: str) -> None:
        ctx.add(
            {"origin": "string", "code": "invalid_format", "format": fmt, "path": path, "message": message},
            fatal=False,
        )


def _is_url(value: str) -> bool:
    try:
        parts = urlsplit(value)
    except ValueError:
        return False
    return bool(parts.scheme) and (bool(parts.netloc) or parts.scheme in ("mailto", "data", "tel"))


# ---------------------------------------------------------------------------
# Numbers and booleans
# ---------------------------------------------------------------------------


def js_number(value: Any) -> float:
    """JavaScript's `Number(value)`, for `z.coerce.number()`."""
    if value is UNDEFINED:
        return math.nan
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, list):
        if len(value) == 0:
            return 0.0
        if len(value) == 1:
            return js_number(value[0] if not isinstance(value[0], list) else value[0])
        return math.nan
    if isinstance(value, str):
        text = js_trim(value)
        if text == "":
            return 0.0
        lowered = text.lower()
        try:
            if lowered.startswith(("0x", "0o", "0b")) and not text.startswith(("+", "-")):
                return float(int(text, 0))
            if text in ("Infinity", "+Infinity"):
                return math.inf
            if text == "-Infinity":
                return -math.inf
            if re.fullmatch(r"[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?", text):
                return float(text)
        except ValueError:
            return math.nan
        return math.nan
    return math.nan


def _js_num_text(n: float | int) -> str:
    if isinstance(n, float) and n.is_integer():
        return str(int(n))
    return str(n)


class NumberSchema(Schema):
    def __init__(self, coerce: bool = False) -> None:
        self.coerce = coerce
        self.ops: list[tuple[str, Any]] = []
        self.integer = False

    def _with(self, op: str, arg: Any = None) -> "NumberSchema":
        clone = NumberSchema(self.coerce)
        clone.ops = [*self.ops, (op, arg)]
        clone.integer = self.integer or op == "int"
        return clone

    def int(self, message: str | None = None) -> "NumberSchema":
        return self._with("int", message)

    def positive(self, message: str | None = None) -> "NumberSchema":
        return self._with("gt", (0, message))

    def nonnegative(self, message: str | None = None) -> "NumberSchema":
        return self._with("gte", (0, message))

    def negative(self, message: str | None = None) -> "NumberSchema":
        return self._with("lt", (0, message))

    def min(self, n: float, message: str | None = None) -> "NumberSchema":
        return self._with("gte", (n, message))

    gte = min

    def max(self, n: float, message: str | None = None) -> "NumberSchema":
        return self._with("lte", (n, message))

    lte = max

    def gt(self, n: float, message: str | None = None) -> "NumberSchema":
        return self._with("gt", (n, message))

    def lt(self, n: float, message: str | None = None) -> "NumberSchema":
        return self._with("lt", (n, message))

    def multiple_of(self, n: float, message: str | None = None) -> "NumberSchema":
        return self._with("multiple_of", (n, message))

    def finite(self) -> "NumberSchema":
        return self

    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        if self.coerce:
            value = js_number(value)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            _type_issue(ctx, path, "number", value)
            return value
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            _type_issue(ctx, path, "number", value)
            return value
        number: int | float = value
        # JavaScript has one number type: 5.0 is 5, and serialises as 5.
        if isinstance(number, float) and number.is_integer() and abs(number) <= 2**63:
            number = int(number)
        kind = "int" if self.integer else "number"
        for op, arg in self.ops:
            if op == "int":
                if isinstance(number, float) and not number.is_integer():
                    ctx.add(
                        {
                            "expected": "int",
                            "code": "invalid_type",
                            "path": path,
                            "message": arg or "Invalid input: expected int, received number",
                        },
                        fatal=True,
                    )
                    return number
                if abs(number) > MAX_SAFE_INTEGER:
                    edge = MAX_SAFE_INTEGER if number > 0 else -MAX_SAFE_INTEGER
                    code = "too_big" if number > 0 else "too_small"
                    sign = "<=" if number > 0 else ">="
                    word = "Too big" if number > 0 else "Too small"
                    ctx.add(
                        {
                            "origin": "int",
                            "code": code,
                            "path": path,
                            "message": f"{word}: expected int to be {sign}{edge}",
                        },
                        fatal=False,
                    )
            elif op in ("gt", "gte", "lt", "lte"):
                n, message = arg
                failed = {
                    "gt": number <= n,
                    "gte": number < n,
                    "lt": number >= n,
                    "lte": number > n,
                }[op]
                if failed:
                    small = op in ("gt", "gte")
                    sign = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
                    ctx.add(
                        {
                            "origin": kind,
                            "code": "too_small" if small else "too_big",
                            ("minimum" if small else "maximum"): n,
                            "inclusive": op in ("gte", "lte"),
                            "path": path,
                            "message": message
                            or f"{'Too small' if small else 'Too big'}: expected {kind} to be {sign}{_js_num_text(n)}",
                        },
                        fatal=False,
                    )
            elif op == "multiple_of":
                n, message = arg
                if number % n != 0:
                    ctx.add(
                        {
                            "origin": kind,
                            "code": "not_multiple_of",
                            "divisor": n,
                            "path": path,
                            "message": message or f"Invalid number: must be a multiple of {_js_num_text(n)}",
                        },
                        fatal=False,
                    )
        return number


class BooleanSchema(Schema):
    def __init__(self, coerce: bool = False) -> None:
        self.coerce = coerce

    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        if self.coerce:
            return _js_truthy(value)
        if not isinstance(value, bool):
            _type_issue(ctx, path, "boolean", value)
        return value


def _js_truthy(value: Any) -> bool:
    if value is UNDEFINED or value is None or value is False:
        return False
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return not (value == 0 or (isinstance(value, float) and math.isnan(value)))
    if isinstance(value, str):
        return value != ""
    return True


class LiteralSchema(Schema):
    def __init__(self, *values: Any) -> None:
        self.values = values

    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        if not any(value == v and type(value) is type(v) for v in self.values):
            shown = "|".join(_js_literal(v) for v in self.values)
            ctx.add(
                {
                    "code": "invalid_value",
                    "values": list(self.values),
                    "path": path,
                    "message": f"Invalid input: expected {shown}",
                },
                fatal=True,
            )
        return value


def _js_literal(value: Any) -> str:
    if isinstance(value, str):
        return f'"{value}"'
    if value is True:
        return "true"
    if value is False:
        return "false"
    if value is None:
        return "null"
    return str(value)


class EnumSchema(Schema):
    def __init__(self, values: Iterable[str]) -> None:
        self.options = tuple(values)

    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        if not isinstance(value, str) or value not in self.options:
            shown = "|".join(f'"{v}"' for v in self.options)
            ctx.add(
                {
                    "code": "invalid_value",
                    "values": list(self.options),
                    "path": path,
                    "message": f"Invalid option: expected one of {shown}",
                },
                fatal=True,
            )
        return value


class UnknownSchema(Schema):
    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        return value


class NullSchema(Schema):
    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        if value is not None:
            _type_issue(ctx, path, "null", value)
        return value


# ---------------------------------------------------------------------------
# Arrays, records, objects, unions
# ---------------------------------------------------------------------------


class ArraySchema(Schema):
    def __init__(self, element: Schema) -> None:
        self.element = element
        self.ops: list[tuple[str, Any]] = []

    def _with(self, op: str, arg: Any) -> "ArraySchema":
        clone = ArraySchema(self.element)
        clone.ops = [*self.ops, (op, arg)]
        return clone

    def min(self, n: int, message: str | None = None) -> "ArraySchema":
        return self._with("min", (n, message))

    def max(self, n: int, message: str | None = None) -> "ArraySchema":
        return self._with("max", (n, message))

    def length(self, n: int, message: str | None = None) -> "ArraySchema":
        return self._with("length", (n, message))

    def nonempty(self, message: str | None = None) -> "ArraySchema":
        return self.min(1, message)

    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        if not isinstance(value, list):
            _type_issue(ctx, path, "array", value)
            return value
        out = []
        for index, item in enumerate(value):
            parsed = self.element._parse(item, [*path, index], ctx)
            out.append(None if parsed is UNDEFINED else parsed)
        for op, (n, message) in self.ops:
            size = len(out)
            if op == "min" and size < n:
                ctx.add(
                    {
                        "origin": "array",
                        "code": "too_small",
                        "minimum": n,
                        "inclusive": True,
                        "path": path,
                        "message": message or f"Too small: expected array to have >={n} items",
                    },
                    fatal=False,
                )
            elif op == "max" and size > n:
                ctx.add(
                    {
                        "origin": "array",
                        "code": "too_big",
                        "maximum": n,
                        "inclusive": True,
                        "path": path,
                        "message": message or f"Too big: expected array to have <={n} items",
                    },
                    fatal=False,
                )
            elif op == "length" and size != n:
                ctx.add(
                    {
                        "origin": "array",
                        "code": "too_big" if size > n else "too_small",
                        "path": path,
                        "message": message
                        or f"Too {'big' if size > n else 'small'}: expected array to have exactly {n} items",
                    },
                    fatal=False,
                )
        return out


class RecordSchema(Schema):
    def __init__(self, key: Schema, value: Schema) -> None:
        self.key = key
        self.value = value

    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        if not isinstance(value, dict):
            _type_issue(ctx, path, "record", value)
            return value
        out: dict[str, Any] = {}
        for k, v in value.items():
            parsed_key = self.key._parse(k, [*path, k], ctx)
            parsed = self.value._parse(v, [*path, k], ctx)
            if parsed is not UNDEFINED:
                out[parsed_key] = parsed
        return out


class ObjectSchema(Schema):
    def __init__(self, shape: Mapping[str, Schema], mode: str = "strip") -> None:
        self.shape = dict(shape)
        #: "strip" (z.object), "strict" (z.strictObject), "passthrough"
        self.mode = mode

    def extend(self, shape: Mapping[str, Schema]) -> "ObjectSchema":
        return ObjectSchema({**self.shape, **shape}, self.mode)

    def merge(self, other: "ObjectSchema") -> "ObjectSchema":
        return ObjectSchema({**self.shape, **other.shape}, other.mode)

    def strict(self) -> "ObjectSchema":
        return ObjectSchema(self.shape, "strict")

    def passthrough(self) -> "ObjectSchema":
        return ObjectSchema(self.shape, "passthrough")

    def pick(self, *keys: str) -> "ObjectSchema":
        return ObjectSchema({k: v for k, v in self.shape.items() if k in keys}, self.mode)

    def omit(self, *keys: str) -> "ObjectSchema":
        return ObjectSchema({k: v for k, v in self.shape.items() if k not in keys}, self.mode)

    def partial(self) -> "ObjectSchema":
        return ObjectSchema({k: _Optional(v) for k, v in self.shape.items()}, self.mode)

    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        if not isinstance(value, dict):
            _type_issue(ctx, path, "object", value)
            return value
        out: dict[str, Any] = {}
        for key, schema in self.shape.items():
            parsed = schema._parse(value.get(key, UNDEFINED), [*path, key], ctx)
            if parsed is not UNDEFINED:
                out[key] = parsed
        unknown = [key for key in value if key not in self.shape]
        if unknown and self.mode == "strict":
            shown = ", ".join(f'"{key}"' for key in unknown)
            ctx.add(
                {
                    "code": "unrecognized_keys",
                    "keys": unknown,
                    "path": path,
                    "message": f"Unrecognized key{'s' if len(unknown) > 1 else ''}: {shown}",
                },
                fatal=False,
            )
        elif unknown and self.mode == "passthrough":
            for key in unknown:
                out[key] = value[key]
        return out


class UnionSchema(Schema):
    def __init__(self, options: Sequence[Schema]) -> None:
        self.options = list(options)

    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        results: list[tuple[Any, Ctx]] = []
        for option in self.options:
            own = Ctx()
            out = option._parse(value, path, own)
            if not own.issues:
                return out
            results.append((out, own))
        nonaborted = [r for r in results if not _aborted(r[1], 0)]
        if len(nonaborted) == 1:
            ctx.issues.extend(nonaborted[0][1].issues)
            return nonaborted[0][0]
        ctx.add(
            {
                "code": "invalid_union",
                "errors": [own.issues for _, own in results],
                "path": path,
                "message": "Invalid input",
            },
            fatal=True,
        )
        return value


class DiscriminatedUnionSchema(Schema):
    def __init__(self, key: str, options: Sequence[ObjectSchema]) -> None:
        self.key = key
        self.options = list(options)

    def _values(self, option: Schema) -> tuple[Any, ...]:
        target = option
        while isinstance(target, (_Refine, _SuperRefine)):
            target = target.inner
        discriminator = target.shape[self.key]  # type: ignore[attr-defined]
        if isinstance(discriminator, LiteralSchema):
            return discriminator.values
        if isinstance(discriminator, EnumSchema):
            return discriminator.options
        raise TypeError("a discriminated union's key must be a literal or an enum")

    def _parse(self, value: Any, path: list[Any], ctx: Ctx) -> Any:
        if not isinstance(value, dict):
            _type_issue(ctx, path, "object", value)
            return value
        tag = value.get(self.key, UNDEFINED)
        for option in self.options:
            if tag in self._values(option) and tag is not UNDEFINED:
                return option._parse(value, path, ctx)
        expected = " | ".join(f"'{v}'" for option in self.options for v in self._values(option))
        ctx.add(
            {
                "code": "invalid_union",
                "errors": [],
                "note": "No matching discriminator",
                "discriminator": self.key,
                "path": [*path, self.key],
                "message": f"Invalid discriminator value. Expected {expected}",
            },
            fatal=True,
        )
        return value


# ---------------------------------------------------------------------------
# The `z` namespace
# ---------------------------------------------------------------------------


class _Coerce:
    @staticmethod
    def number() -> NumberSchema:
        return NumberSchema(coerce=True)

    @staticmethod
    def boolean() -> BooleanSchema:
        return BooleanSchema(coerce=True)


class _Iso:
    @staticmethod
    def date() -> StringSchema:
        return StringSchema().date()

    @staticmethod
    def datetime(*, offset: bool = False) -> StringSchema:
        return StringSchema().datetime(offset=offset)


class z:  # noqa: N801 - read as zod's `z`
    coerce = _Coerce()
    iso = _Iso()

    @staticmethod
    def string() -> StringSchema:
        return StringSchema()

    @staticmethod
    def number() -> NumberSchema:
        return NumberSchema()

    @staticmethod
    def int() -> NumberSchema:
        return NumberSchema().int()

    @staticmethod
    def boolean() -> BooleanSchema:
        return BooleanSchema()

    @staticmethod
    def literal(*values: Any) -> LiteralSchema:
        return LiteralSchema(*values)

    @staticmethod
    def enum(values: Iterable[str]) -> EnumSchema:
        return EnumSchema(values)

    @staticmethod
    def array(element: Schema) -> ArraySchema:
        return ArraySchema(element)

    @staticmethod
    def record(key: Schema, value: Schema) -> RecordSchema:
        return RecordSchema(key, value)

    @staticmethod
    def object(shape: Mapping[str, Schema]) -> ObjectSchema:
        return ObjectSchema(shape, "strip")

    @staticmethod
    def strict_object(shape: Mapping[str, Schema]) -> ObjectSchema:
        return ObjectSchema(shape, "strict")

    @staticmethod
    def union(options: Sequence[Schema]) -> UnionSchema:
        return UnionSchema(options)

    @staticmethod
    def discriminated_union(key: str, options: Sequence[ObjectSchema]) -> DiscriminatedUnionSchema:
        return DiscriminatedUnionSchema(key, options)

    @staticmethod
    def unknown() -> UnknownSchema:
        return UnknownSchema()

    @staticmethod
    def any() -> UnknownSchema:
        return UnknownSchema()

    @staticmethod
    def null() -> NullSchema:
        return NullSchema()

    @staticmethod
    def uuid() -> StringSchema:
        return StringSchema().uuid()

    @staticmethod
    def email() -> StringSchema:
        return StringSchema().email()

    @staticmethod
    def url() -> StringSchema:
        return StringSchema().url()

    NEVER = NEVER


def is_iso_date(value: str) -> bool:
    if _ISO_DATE.fullmatch(value) is None:
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True
