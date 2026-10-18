"""Offline sync request shapes (port of `schemas/sync.schema.ts`; SY-01..08, FR-OFF-01)."""

from __future__ import annotations

from ...core.schema import z
from ..enums import QUEUE_EVENT_TYPES

uuid = z.string().uuid()

MAX_BATCH_SIZE = 500

sync_entry = z.object(
    {
        "clientEventId": uuid,
        "type": z.enum(list(QUEUE_EVENT_TYPES)),
        "payload": z.record(z.string(), z.unknown()).default({}),
        "clientTs": z.string().datetime(offset=True).nullable().default(None),
    }
)

sync_batch_body = z.object({"sessionId": uuid, "events": z.array(sync_entry).min(1).max(MAX_BATCH_SIZE)})

sync_pull_query = z.object(
    {
        "sinceSeq": z.coerce.number().int().nonnegative().default(0),
        "lastSyncedAt": z.string().datetime(offset=True).optional(),
    }
)

sync_params = z.object({"id": uuid})
