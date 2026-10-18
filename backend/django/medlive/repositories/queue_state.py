"""The `queue_state` cache (port of `repositories/queueState.repo.ts`; DB-P1: a cache)."""

from __future__ import annotations

from typing import Any

from ..core import db


def find(session_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT session_id, now_serving_booking_id, now_serving_serial, waiting_count,
               late_count, no_show_count, done_count, avg_consult_seconds,
               projected_end, rebuilt_from_seq, updated_at
          FROM queue_state
         WHERE session_id = %s
        """,
        [session_id],
    )
    if row is None:
        return None
    return {
        "sessionId": row["session_id"],
        "nowServingBookingId": row["now_serving_booking_id"],
        "nowServingSerial": row["now_serving_serial"],
        "waitingCount": row["waiting_count"],
        "lateCount": row["late_count"],
        "noShowCount": row["no_show_count"],
        "doneCount": row["done_count"],
        "avgConsultSeconds": row["avg_consult_seconds"],
        "projectedEnd": row["projected_end"],
        "rebuiltFromSeq": int(row["rebuilt_from_seq"]),
        "updatedAt": row["updated_at"],
    }


def save(projection: dict[str, Any], projected_end: str | None) -> None:
    values = [
        projection["sessionId"],
        projection["nowServingBookingId"],
        projection["nowServingSerial"],
        projection["waitingCount"],
        projection["lateCount"],
        projection["noShowCount"],
        projection["doneCount"],
        projection["avgConsultSeconds"],
        projected_end,
        str(projection["rebuiltFromSeq"]),
    ]
    db.execute(
        """
        INSERT INTO queue_state
          (session_id, now_serving_booking_id, now_serving_serial, waiting_count, late_count,
           no_show_count, done_count, avg_consult_seconds, projected_end, rebuilt_from_seq)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (session_id) DO UPDATE SET
          now_serving_booking_id = excluded.now_serving_booking_id,
          now_serving_serial = excluded.now_serving_serial,
          waiting_count = excluded.waiting_count,
          late_count = excluded.late_count,
          no_show_count = excluded.no_show_count,
          done_count = excluded.done_count,
          avg_consult_seconds = excluded.avg_consult_seconds,
          projected_end = excluded.projected_end,
          rebuilt_from_seq = excluded.rebuilt_from_seq
        """,
        values,
    )


def clear(session_id: str) -> None:
    db.execute("DELETE FROM queue_state WHERE session_id = %s", [session_id])
