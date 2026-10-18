"""The one door to SQL (port of `config/db.ts`).

The bottom of the layering chain: routes -> controllers -> services ->
repositories -> db. Only `medlive.repositories` may import this module
(`tests/test_layering.py` holds that).

## The scope is stated on every connection before it is used

Exactly as `connectScoped` does in Node: when SQL runs outside a transaction,
the scope in force (`core/scope.py`) is stated on the connection first; a
transaction states it once, as it opens, and keeps it. A connection last used
for one hospital never serves another under the first one's name. The
statement is session-level (`set_config(..., false)`), and skipped only when
the connection already says exactly this.

A transaction opened by anything other than `transaction()` below (Django's
own `atomic`, say) states the scope locally to that transaction instead, so a
rollback can never leave a connection believed to say something it does not.

## Values arrive as the Node driver delivered them

`int8` and `numeric` as strings, `date` as `YYYY-MM-DD`, `uuid` as a string,
`json`/`jsonb` parsed, `timestamptz` as an aware UTC datetime truncated to the
millisecond (a JavaScript `Date`). Porting a repository is then mechanical:
whatever the TypeScript did with a value, the Python does with the same value.
"""

from __future__ import annotations

import json
import threading
import weakref
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator, Mapping, Sequence

import psycopg
from django.db import connection
from django.db import transaction as django_transaction
from django.db.backends.signals import connection_created
from django.dispatch import receiver
from psycopg.adapt import Loader
from psycopg.types.json import Jsonb

from .scope import current_db_scope, statement_of

# ---------------------------------------------------------------------------
# Loaders: the Node driver's shapes
# ---------------------------------------------------------------------------


class _TextLoader(Loader):
    def load(self, data: Any) -> str:
        return bytes(data).decode("utf8")


class _JsonLoader(Loader):
    def load(self, data: Any) -> Any:
        return json.loads(bytes(data).decode("utf8"))


class _TimestamptzLoader(Loader):
    """Parses `timestamptz` text, truncated to the millisecond like a JS Date.

    Django sets every connection's `TimeZone` to UTC, so the text always ends
    in `+00`. `timezone` is what Django's backend compares before each cursor:
    matching it keeps Django from putting its own loader back.
    """

    timezone = timezone.utc

    def load(self, data: Any) -> datetime | str:
        text = bytes(data).decode("ascii")
        if text in ("infinity", "-infinity"):
            return text
        value = datetime.fromisoformat(text.replace(" ", "T", 1))
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        value = value.astimezone(timezone.utc)
        return value.replace(microsecond=(value.microsecond // 1000) * 1000)


_TEXT_TYPES = ("int8", "numeric", "date", "uuid", "time", "timetz", "interval", "inet", "money")


def _register_loaders(adapters: Any) -> None:
    for name in _TEXT_TYPES:
        adapters.register_loader(name, _TextLoader)
    adapters.register_loader("json", _JsonLoader)
    adapters.register_loader("jsonb", _JsonLoader)
    adapters.register_loader("timestamptz", _TimestamptzLoader)


@receiver(connection_created)
def _on_connection_created(sender: Any, connection: Any, **_: Any) -> None:
    raw = connection.connection
    if raw is not None:
        _register_loaders(raw.adapters)


# ---------------------------------------------------------------------------
# Scope
# ---------------------------------------------------------------------------

_stated: "weakref.WeakKeyDictionary[Any, tuple[str, str, str, str]]" = weakref.WeakKeyDictionary()
_SET_SCOPE = (
    "SELECT set_config('app.scope', %s, {local}), set_config('app.hospital_id', %s, {local}), "
    "set_config('app.person_id', %s, {local}), set_config('app.booking_id', %s, {local})"
)

# How deep in `transaction()` blocks of ours this thread is. Per thread,
# because Django's connections are per thread.
_local = threading.local()


def _own_depth() -> int:
    return int(getattr(_local, "depth", 0))


def _raw_connection() -> Any:
    connection.ensure_connection()
    return connection.connection


def _state_scope(*, local: bool) -> None:
    raw = _raw_connection()
    saying = statement_of(current_db_scope())
    if not local and _stated.get(raw) == saying:
        return
    try:
        with raw.cursor() as cursor:
            cursor.execute(
                _SET_SCOPE.format(local="true" if local else "false"),
                list(saying),
            )
    except Exception:
        # A connection the scope could not be stated on must not be used
        # saying something else: drop it.
        _stated.pop(raw, None)
        connection.close()
        raise
    if not local:
        _stated[raw] = saying


def _before_statement() -> None:
    if not connection.in_atomic_block:
        _state_scope(local=False)
    elif _own_depth() == 0:
        # Somebody else's atomic block: say it for this transaction only.
        _state_scope(local=True)


@contextmanager
def transaction() -> Iterator[None]:
    """A transaction that states the scope once, as it opens (Kysely's `db.transaction()`)."""
    if not connection.in_atomic_block:
        _state_scope(local=False)
    with django_transaction.atomic():
        _local.depth = _own_depth() + 1
        try:
            yield
        finally:
            _local.depth = _own_depth() - 1


def on_commit(callback: Any) -> None:
    """Runs `callback` after the outermost transaction commits (at once outside one)."""
    django_transaction.on_commit(callback)


def in_transaction() -> bool:
    return bool(connection.in_atomic_block)


# ---------------------------------------------------------------------------
# Running SQL
# ---------------------------------------------------------------------------

Params = Sequence[Any] | Mapping[str, Any] | None


def _adapt(params: Params) -> Any:
    if params is None:
        return None
    if isinstance(params, Mapping):
        return {key: _adapt_value(value) for key, value in params.items()}
    return [_adapt_value(value) for value in params]


def _adapt_value(value: Any) -> Any:
    if isinstance(value, Json):
        return Jsonb(value.value)
    return value


class Json:
    """Marks a parameter to be sent as `jsonb`."""

    __slots__ = ("value",)

    def __init__(self, value: Any) -> None:
        self.value = value


def _rows(cursor: Any) -> list[dict[str, Any]]:
    if cursor.description is None:
        return []
    names = [column.name for column in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


def fetch_all(sql: str, params: Params = None) -> list[dict[str, Any]]:
    """Every row, as dicts keyed by column name."""
    _before_statement()
    with connection.cursor() as cursor:
        cursor.execute(sql, _adapt(params))
        return _rows(cursor)


def fetch_one(sql: str, params: Params = None) -> dict[str, Any] | None:
    """The first row, or None."""
    rows = fetch_all(sql, params)
    return rows[0] if rows else None


def fetch_value(sql: str, params: Params = None) -> Any:
    """The first column of the first row, or None."""
    row = fetch_one(sql, params)
    if row is None:
        return None
    return next(iter(row.values()))


def execute(sql: str, params: Params = None) -> int:
    """Runs a statement; the number of rows it touched."""
    _before_statement()
    with connection.cursor() as cursor:
        cursor.execute(sql, _adapt(params))
        return int(cursor.rowcount)


def execute_returning(sql: str, params: Params = None) -> list[dict[str, Any]]:
    """Runs a statement with `RETURNING` and gives back its rows."""
    return fetch_all(sql, params)


def current_settings() -> dict[str, str]:
    """What this connection says it is working for (a test's view)."""
    row = fetch_one(
        "SELECT current_setting('app.scope', true) AS scope, "
        "current_setting('app.hospital_id', true) AS hospital_id, "
        "current_setting('app.person_id', true) AS person_id, "
        "current_setting('app.booking_id', true) AS booking_id"
    )
    return {key: str(value or "") for key, value in (row or {}).items()}


def close() -> None:
    connection.close()


__all__ = [
    "Json",
    "close",
    "current_settings",
    "execute",
    "execute_returning",
    "fetch_all",
    "fetch_one",
    "fetch_value",
    "in_transaction",
    "on_commit",
    "psycopg",
    "transaction",
]
