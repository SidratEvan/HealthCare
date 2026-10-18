"""The append-only queue event log (port of `repositories/queueEvent.repo.ts`).

Append only: a trigger refuses any update except marking an event undone
(`GR-02`), and `client_event_id` is unique, which is what makes an offline
replay safe (`SY-02`).
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from ..core import db
from ..domain.queue.events import booking_id_of
from ..domain.time import from_datetime

EVENT_COLUMNS = """
  id, seq, session_id, type, booking_id, actor_staff_id, actor_user_id,
  actor_role, payload, client_ts, server_ts, client_event_id, undone_by_event_id
"""


def append(draft: dict[str, Any]) -> dict[str, Any]:
    """Appends one event (inside the caller's transaction) and returns it as stored."""
    actor = _actor_columns(draft["actor"])
    row = db.fetch_one(
        f"""
        INSERT INTO queue_events
          (session_id, type, booking_id, actor_staff_id, actor_user_id, actor_role,
           payload, client_ts, server_ts, client_event_id)
        VALUES (%s, %s::queue_event_type, %s, %s, %s, %s::staff_role, %s::jsonb, %s,
                clock_timestamp(), %s)
        RETURNING {EVENT_COLUMNS}
        """,
        [
            draft["sessionId"],
            draft["type"],
            booking_id_of({"type": draft["type"], "payload": draft["payload"]}),
            actor["staffId"],
            actor["userId"],
            actor["role"],
            json.dumps(draft["payload"], ensure_ascii=False, separators=(",", ":")),
            draft.get("clientTs"),
            draft.get("clientEventId"),
        ],
    )
    if row is None:
        raise RuntimeError("queue_events insert returned no row.")
    return to_queue_event(row)


def find_by_client_event_id(client_event_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        f"SELECT {EVENT_COLUMNS} FROM queue_events WHERE client_event_id = %s", [client_event_id]
    )
    return None if row is None else to_queue_event(row)


def applied_among(session_id: str, client_event_ids: list[str], upto_seq: int) -> list[dict[str, Any]]:
    if not client_event_ids:
        return []
    rows = db.fetch_all(
        """
        SELECT client_event_id, seq, id
          FROM queue_events
         WHERE session_id = %s
           AND client_event_id = ANY(%s::uuid[])
           AND seq <= %s
         ORDER BY seq
        """,
        [session_id, list(client_event_ids), upto_seq],
    )
    return [{"clientEventId": r["client_event_id"], "seq": int(r["seq"]), "eventId": r["id"]} for r in rows]


def find_by_id(event_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(f"SELECT {EVENT_COLUMNS} FROM queue_events WHERE id = %s", [event_id])
    return None if row is None else to_queue_event(row)


def list_for_session(session_id: str, after_seq: int = 0) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        f"""
        SELECT {EVENT_COLUMNS}
          FROM queue_events
         WHERE session_id = %s AND seq > %s::bigint
         ORDER BY seq
        """,
        [session_id, str(after_seq)],
    )
    return [to_queue_event(r) for r in rows]


def mark_undone(event_id: str, undone_by_event_id: str) -> None:
    db.execute(
        """
        UPDATE queue_events
           SET undone_by_event_id = %s
         WHERE id = %s AND undone_by_event_id IS NULL
        """,
        [undone_by_event_id, event_id],
    )


def last_seq_of(session_id: str) -> int:
    value = db.fetch_value(
        "SELECT max(seq)::text AS max_seq FROM queue_events WHERE session_id = %s", [session_id]
    )
    return int(value or 0)


def to_queue_event(row: dict[str, Any]) -> dict[str, Any]:
    client_ts: datetime | None = row["client_ts"]
    return {
        "id": row["id"],
        "sessionId": row["session_id"],
        "seq": int(row["seq"]),
        "serverTs": from_datetime(row["server_ts"]),
        "clientTs": None if client_ts is None else from_datetime(client_ts),
        "clientEventId": row["client_event_id"],
        "actor": _to_actor(row),
        "type": row["type"],
        "payload": row["payload"],
    }


def _to_actor(row: dict[str, Any]) -> dict[str, Any]:
    if row["actor_staff_id"] is not None and row["actor_role"] is not None:
        return {"kind": "staff", "staffUserId": row["actor_staff_id"], "role": row["actor_role"]}
    if row["actor_user_id"] is not None:
        return {"kind": "patient", "userId": row["actor_user_id"]}
    return {"kind": "system", "job": "unattributed"}


def _actor_columns(actor: dict[str, Any]) -> dict[str, Any]:
    if actor["kind"] == "staff":
        return {"staffId": actor["staffUserId"], "userId": None, "role": actor["role"]}
    if actor["kind"] == "patient":
        return {"staffId": None, "userId": actor["userId"], "role": None}
    return {"staffId": None, "userId": None, "role": None}
