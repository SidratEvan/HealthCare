/**
 * The append-only log (`DB-P1`).
 *
 * This repository writes and reads `queue_events` and does nothing else. It
 * never updates a row and never deletes one — the database refuses both by
 * trigger, and the point of keeping the writer this small is that there is one
 * place to check that claim against.
 *
 * The one permitted mutation, setting `undone_by_event_id` once, is here as
 * `markUndone`, because the alternative is a service reaching for raw SQL to
 * do the one thing the trigger allows.
 *
 * Queries are `sql<T>` templates rather than the builder. BACKEND.md §0 allows
 * raw SQL for hot paths and this is the hottest one in the product: every
 * queue mutation reads this table inside the lock that every other counter is
 * waiting on. An explicit row type also says plainly that `seq` comes back as
 * a string — a bigserial narrowed by a query builder is a precision bug nobody
 * sees until the numbers are large.
 */

import { sql } from 'kysely';

import { bookingIdOf, id } from '@platform/domain';
import type {
  QueueActor,
  QueueEvent,
  QueueEventId,
  QueueEventType,
  SessionId,
  StaffRole,
  Timestamp,
} from '@platform/domain';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

/** An event on its way into the log, before the database assigns id and seq. */
export interface EventDraft {
  readonly sessionId: string;
  readonly type: QueueEventType;
  readonly payload: Record<string, unknown>;
  readonly actor: QueueActor;
  readonly clientEventId: string | null;
  readonly clientTs: Date | null;
}

interface EventQueryRow {
  id: string;
  /** bigserial: returned as a string so precision is never silently lost. */
  seq: string;
  session_id: string;
  type: QueueEventType;
  booking_id: string | null;
  actor_staff_id: string | null;
  actor_user_id: string | null;
  actor_role: StaffRole | null;
  payload: Record<string, unknown>;
  client_ts: Date | null;
  server_ts: Date;
  client_event_id: string | null;
  undone_by_event_id: string | null;
}

const EVENT_COLUMNS = sql`
  id, seq, session_id, type, booking_id, actor_staff_id, actor_user_id,
  actor_role, payload, client_ts, server_ts, client_event_id, undone_by_event_id
`;

/**
 * Appends one event and returns it as the domain sees it.
 *
 * ## Why `server_ts` is `clock_timestamp()` and not the column default
 *
 * The column defaults to `now()`, which in PostgreSQL is the **transaction**
 * timestamp — fixed at `BEGIN`, before this transaction waited for the session
 * lock. That is right for `updated_at` (erring older is safe for a freshness
 * line) and wrong here, and the difference is not theoretical:
 *
 *   counter A begins at 10:00:00.000, takes the lock, calls serial 1,
 *     stamping `called_at` 10:00:00.000, commits at 10:00:00.120
 *   counter B began at 10:00:00.050 and has been waiting for the lock. It
 *     proceeds, finishes serial 1 — and stamps `done_at` 10:00:00.050,
 *     which is *before* the patient was called.
 *
 * `bookings_done_after_called` refuses that, correctly: a consultation cannot
 * end before it began. `clock_timestamp()` is read when the row is written,
 * which is necessarily after the lock was granted, so the log's timestamps
 * increase in the order the events actually happened.
 *
 * Ordering itself still rests on `seq`, never on a timestamp (`SY-01`, `DB-P9`).
 */
export async function append(trx: Tx, draft: EventDraft): Promise<QueueEvent> {
  const actor = actorColumns(draft.actor);

  const result = await sql<EventQueryRow>`
    INSERT INTO queue_events
      (session_id, type, booking_id, actor_staff_id, actor_user_id, actor_role,
       payload, client_ts, server_ts, client_event_id)
    VALUES (
      ${draft.sessionId},
      ${draft.type}::queue_event_type,
      ${bookingIdFor(draft)},
      ${actor.staffId},
      ${actor.userId},
      ${actor.role}::staff_role,
      ${JSON.stringify(draft.payload)}::jsonb,
      ${draft.clientTs},
      clock_timestamp(),
      ${draft.clientEventId}
    )
    RETURNING ${EVENT_COLUMNS}
  `.execute(trx);

  const row = result.rows[0];
  if (row === undefined) throw new Error('queue_events insert returned no row.');
  return toQueueEvent(row);
}

/**
 * Finds a previously stored event by its client-supplied idempotency key.
 *
 * Step 1 of `appendEvent` (BACKEND.md §4.1): a console re-sending a batch
 * after a dropped response gets the stored result rather than a second advance
 * of the queue (`FR-QUE-51`, `SY-02`).
 */
export async function findByClientEventId(
  clientEventId: string,
  trx?: Tx,
): Promise<QueueEvent | null> {
  // Reads through the transaction when given one. An offline batch checks each
  // entry against the log as it stands *including the entries already applied
  // in this batch* — without that, a batch containing the same key twice would
  // append it twice, which is exactly what `SY-02` exists to prevent.
  const result = await sql<EventQueryRow>`
    SELECT ${EVENT_COLUMNS} FROM queue_events WHERE client_event_id = ${clientEventId}
  `.execute(trx ?? db);

  const row = result.rows[0];
  return row === undefined ? null : toQueueEvent(row);
}

export async function findById(eventId: string): Promise<QueueEvent | null> {
  const result = await sql<EventQueryRow>`
    SELECT ${EVENT_COLUMNS} FROM queue_events WHERE id = ${eventId}
  `.execute(db);

  const row = result.rows[0];
  return row === undefined ? null : toQueueEvent(row);
}

/**
 * Every event for a session, in log order.
 *
 * `seq` orders it, never `server_ts` and never the id: two events inside one
 * transaction share a timestamp, and a v7 uuid is only sortable to the
 * millisecond (`DB-P9`).
 */
export async function listForSession(
  sessionId: string,
  afterSeq = 0,
  trx?: Tx,
): Promise<QueueEvent[]> {
  const result = await sql<EventQueryRow>`
    SELECT ${EVENT_COLUMNS}
      FROM queue_events
     WHERE session_id = ${sessionId} AND seq > ${String(afterSeq)}::bigint
     ORDER BY seq
  `.execute(trx ?? db);

  return result.rows.map(toQueueEvent);
}

/**
 * Records that a later `ACTION_UNDONE` compensated this event (`GR-02`).
 *
 * The only update `trg_queue_events_no_mutate` permits, and only from null.
 * The recorded fact itself never changes: undo appends a compensating event,
 * it does not erase one.
 */
export async function markUndone(trx: Tx, eventId: string, undoneByEventId: string): Promise<void> {
  await sql`
    UPDATE queue_events
       SET undone_by_event_id = ${undoneByEventId}
     WHERE id = ${eventId} AND undone_by_event_id IS NULL
  `.execute(trx);
}

/** The highest sequence number a session has reached. */
export async function lastSeqOf(sessionId: string): Promise<number> {
  const result = await sql<{ max_seq: string | null }>`
    SELECT max(seq)::text AS max_seq FROM queue_events WHERE session_id = ${sessionId}
  `.execute(db);

  return Number(result.rows[0]?.max_seq ?? 0);
}

/**
 * A row becomes the discriminated union the reducer folds.
 *
 * The cast is where a `jsonb` column meets a typed payload, and it is
 * unavoidable: PostgreSQL returns whatever was written. What makes it safe is
 * that the only writer is `append` above, and the only caller of `append` is
 * the queue service, which builds payloads from the zod schemas in
 * `shared/domain`. Nothing else in the system can put a row in this table.
 */
function toQueueEvent(row: EventQueryRow): QueueEvent {
  const base = {
    id: id<QueueEventId>(row.id),
    sessionId: id<SessionId>(row.session_id),
    seq: Number(row.seq),
    serverTs: row.server_ts.toISOString() as Timestamp,
    clientTs: (row.client_ts?.toISOString() ?? null) as Timestamp | null,
    clientEventId: row.client_event_id,
    actor: toActor(row),
  };

  return { ...base, type: row.type, payload: row.payload } as QueueEvent;
}

function toActor(row: EventQueryRow): QueueActor {
  if (row.actor_staff_id !== null && row.actor_role !== null) {
    return { kind: 'staff', staffUserId: id(row.actor_staff_id), role: row.actor_role };
  }
  if (row.actor_user_id !== null) {
    return { kind: 'patient', userId: id(row.actor_user_id) };
  }
  // A guest acts on their own booking, which the row already names, and a
  // system event has no actor at all. Both read back as system here because
  // the columns cannot tell them apart; the payload and the booking do.
  return { kind: 'system', job: 'unattributed' };
}

function bookingIdFor(draft: EventDraft): string | null {
  // `bookingIdOf` takes a whole event and reads only `type` and `payload`.
  const shaped = { type: draft.type, payload: draft.payload } as unknown as QueueEvent;
  return bookingIdOf(shaped);
}

function actorColumns(actor: QueueActor): {
  staffId: string | null;
  userId: string | null;
  role: StaffRole | null;
} {
  switch (actor.kind) {
    case 'staff':
      return { staffId: actor.staffUserId, userId: null, role: actor.role };
    case 'patient':
      return { staffId: null, userId: actor.userId, role: null };
    case 'guest':
    case 'system':
      return { staffId: null, userId: null, role: null };
  }
}
