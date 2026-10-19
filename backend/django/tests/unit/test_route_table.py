"""The Django route table is the Node API's, route for route and in order.

Read from the TypeScript itself (`backend/api/src/routes/index.ts` and each
`*.routes.ts` it mounts), so a route added to one API and not the other fails
here. Order matters as much as membership: both APIs answer with the first
route that matches, so the same list in the same order answers every request
with the same route.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[4]
ROUTES = REPO / "backend" / "api" / "src" / "routes"

_IMPORT = re.compile(r"import \{ (\w+) \} from '\./([\w.]+)\.js';")
_MOUNT = re.compile(r"router\.use\((\w+)\)")
_ROUTE = re.compile(r"(\w+Routes)\.(get|post|put|patch|delete)\(\s*(['`])([^'`]+)\3", re.MULTILINE)
_LOOP_VALUES = re.compile(r"\['(\w+)', \w+\.\w+\]")


def _routes_of(file: Path) -> list[tuple[str, str]]:
    source = file.read_text(encoding="utf8")
    found: list[tuple[str, str]] = []
    for match in _ROUTE.finditer(source):
        method, path = match.group(2).upper(), match.group(4)
        if "${path}" in path:
            # `for (const [path, handler] of [['commit', ...], ...])`.
            found.extend((method, path.replace("${path}", value)) for value in _LOOP_VALUES.findall(source))
        else:
            found.append((method, path))
    return found


def _node_api_table(mock_payments: bool) -> list[tuple[str, str]]:
    index = (ROUTES / "index.ts").read_text(encoding="utf8")
    files = {name: module for name, module in _IMPORT.findall(index)}
    table: list[tuple[str, str]] = []
    for name in _MOUNT.findall(index):
        if name == "mockPayRoutes" and not mock_payments:
            continue
        table.extend(_routes_of(ROUTES / f"{files[name]}.ts"))
    return table


@pytest.fixture(scope="module")
def django_api_table() -> list[tuple[str, str]]:
    from medlive import routes

    api, _root = routes.build()
    return [(route.method, route.pattern) for route in api.routes]


def test_every_node_route_is_served_by_django_in_the_same_order(django_api_table: list[tuple[str, str]]) -> None:
    node = _node_api_table(mock_payments=True)
    assert len(node) > 150, "the TypeScript route files were not read"
    missing = [route for route in node if route not in django_api_table]
    extra = [route for route in django_api_table if route not in node]
    assert missing == [], f"routes Node serves and Django does not: {missing}"
    assert extra == [], f"routes Django serves and Node does not: {extra}"
    assert django_api_table == node


def test_the_probes_are_the_node_apis() -> None:
    from medlive import routes

    _api, root = routes.build()
    served = [(route.method, route.pattern) for route in root.routes if not route.pattern.startswith("/__test__")]
    assert served == _routes_of(ROUTES / "health.routes.ts")
