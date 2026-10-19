"""An Express-style route table (the routing of `routes/*.routes.ts`).

Written to match Express 5's router where a client could tell the difference:
routes are tried in the order they were added, the first whose method and
path match wins, a path matches case-insensitively and with or without a
trailing slash, `:name` matches one path segment and arrives decoded, a GET
route also answers HEAD, and a path no route matches is `NOT_FOUND` (Express
answers 404, not 405, for a known path asked with another method).

A route is a list of steps, then a handler, exactly as the TypeScript reads:

    queue_routes.post("/sessions/:id/next", require_auth,
                      require_role("receptionist", "doctor"), WRITE,
                      validate(params=SessionParams, body=CallNextBody),
                      queue.call_next)

A step takes the request and returns nothing or raises an `AppError`; the
handler returns a `Reply`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable
from urllib.parse import unquote

from .errors import AppError
from .http import ApiRequest, Reply

Step = Callable[[ApiRequest], None]
Handler = Callable[[ApiRequest], Reply]

_PARAM = re.compile(r":([A-Za-z_][A-Za-z0-9_]*)")


@dataclass(frozen=True)
class Route:
    method: str
    pattern: str
    regex: re.Pattern[str]
    names: tuple[str, ...]
    steps: tuple[Step, ...]
    handler: Handler
    #: A larger body this route parses for itself (`OWN_BODY_LIMIT` in app.ts).
    body_limit: int | None = None
    #: Where that parser sits in the chain, as Express runs it: after this many
    #: steps (`...admin, fileBody, ...` is 2). None: before every step.
    parse_after: int | None = None


def _compile(pattern: str) -> tuple[re.Pattern[str], tuple[str, ...]]:
    names: list[str] = []
    out = []
    position = 0
    for match in _PARAM.finditer(pattern):
        out.append(re.escape(pattern[position : match.start()]))
        out.append("([^/]+?)")
        names.append(match.group(1))
        position = match.end()
    out.append(re.escape(pattern[position:]))
    source = "".join(out).rstrip("/")
    return re.compile(f"^{source}/?$", re.IGNORECASE), tuple(names)


class Router:
    def __init__(self) -> None:
        self.routes: list[Route] = []

    def add(
        self, method: str, pattern: str, *chain: object, body_limit: int | None = None, parse_after: int | None = None
    ) -> None:
        if not chain:
            raise ValueError(f"{method} {pattern} has no handler")
        *steps, handler = chain
        regex, names = _compile(pattern)
        self.routes.append(
            Route(
                method=method,
                pattern=pattern,
                regex=regex,
                names=names,
                steps=tuple(steps),  # type: ignore[arg-type]
                handler=handler,  # type: ignore[arg-type]
                body_limit=body_limit,
                parse_after=parse_after,
            )
        )

    def get(self, pattern: str, *chain: object, **kw: int | None) -> None:
        self.add("GET", pattern, *chain, **kw)

    def post(self, pattern: str, *chain: object, **kw: int | None) -> None:
        self.add("POST", pattern, *chain, **kw)

    def put(self, pattern: str, *chain: object, **kw: int | None) -> None:
        self.add("PUT", pattern, *chain, **kw)

    def patch(self, pattern: str, *chain: object, **kw: int | None) -> None:
        self.add("PATCH", pattern, *chain, **kw)

    def delete(self, pattern: str, *chain: object, **kw: int | None) -> None:
        self.add("DELETE", pattern, *chain, **kw)

    def use(self, other: "Router") -> None:
        self.routes.extend(other.routes)

    def match_path(self, path: str) -> list[tuple[Route, dict[str, str]]]:
        """Every route whose path matches, in order, with its decoded params."""
        found: list[tuple[Route, dict[str, str]]] = []
        for route in self.routes:
            m = route.regex.match(path)
            if m is None:
                continue
            params: dict[str, str] = {}
            for name, value in zip(route.names, m.groups()):
                try:
                    params[name] = unquote(value, errors="strict")
                except UnicodeDecodeError as error:
                    raise AppError("VALIDATION_FAILED", details={"path": "malformed"}) from error
            found.append((route, params))
        return found

    def find(self, method: str, path: str) -> tuple[Route, dict[str, str]] | None:
        wanted = "GET" if method == "HEAD" else method
        for route, params in self.match_path(path):
            if route.method == wanted:
                return route, params
        return None

    def body_limit_for(self, method: str, path: str) -> int | None:
        found = self.find(method, path)
        return found[0].body_limit if found is not None else None
