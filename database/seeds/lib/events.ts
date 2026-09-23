/**
 * Writing a session's event log, and deriving everything that follows from it.
 *
 * `DB-P1`: `queue_events` is the only writable truth about a session, and
 * `queue_state`, `bookings.status` and the projections on `sessions` are all
 * derived. A seed that wrote a plausible-looking `queue_state` directly would
 * produce a demo database that *disagrees with its own event log* — and the
 * first thing step 6 does is replay that log, so the disagreement would surface
 * as a queue jumping when a console loads it.
 *
 * So this module does it the only defensible way round: append the events,
 * replay them through `@platform/domain`, and write whatever the reducer says.
 * The queue reducer exists once (CLAUDE.md §7); the seeds are a consumer of it,
 * not a second implementation.
 */

import {
  bookingIdOf,
  projectedEnd,
  project,
  replay,
  type QueueEvent,
  type QueueEventType,
  type QueueSeed,
  type QueueState,
  type QueueEventId,
  type SessionId,
  type Timestamp,
} from '@platform/domain';

import { insertRows } from './insert.js';

import type { Client } from 'pg';

/**
 * An event before it has an id or a sequence number — those come from the
 * database, because the server clock and the server sequence decide order
 * (`FR-QUE-51`), never the writer.
 */
export type EventDraft = {
  [T in QueueEventType]: Omit<Extract<QueueEvent, { type: T }>, 'id' | 'seq' | 'sessionId'>;
}[QueueEventType];

/** The nil UUID, used only to shape a draft before its real id exists. */
const PROVISIONAL_ID = '00000000-0000-0000-0000-000000000000' as QueueEventId;

/**
 * Appends a session's events in one statement and returns them as the domain
 * sees them, with the ids and sequence numbers the database assigned.
 *
 * Rows go in in the order given, and `seq` is a sequence, so the returned
 * events are already in log order.
 */
export async function appendEvents(
  client: Client,
  sessionId: SessionId,
  drafts: readonly EventDraft[],
): Promise<QueueEvent[]> {
  if (drafts.length === 0) return [];

  // Shaped before insert so `bookingIdOf` — the single definition of which
  // event is about which booking — decides the `booking_id` column, rather
  // than this file restating that mapping and drifting from it.
  const provisional = drafts.map((draft) => materialise(draft, PROVISIONAL_ID, 0, sessionId));

  const rows = provisional.map((event) => {
    const actor = actorColumns(event);
    return [
      sessionId,
      event.type,
      bookingIdOf(event),
      actor.staffId,
      actor.userId,
      actor.role,
      JSON.stringify(event.payload),
      event.clientTs,
      event.serverTs,
      event.clientEventId,
      // The same instant as `server_ts`, so a seeded log does not claim to
      // have been written after the facts it records. Passed as a value rather
      // than as `created_at = server_ts`, because a multi-row VALUES list
      // cannot reference another column of the row it is building.
      event.serverTs,
    ];
  });

  const returned = await insertRows<{ id: string; seq: string }>(
    client,
    'queue_events',
    {
      columns: [
        'session_id',
        'type',
        'booking_id',
        'actor_staff_id',
        'actor_user_id',
        'actor_role',
        'payload',
        'client_ts',
        'server_ts',
        'client_event_id',
        'created_at',
      ],
    },
    rows,
    'id, seq',
  );

  return provisional.map((event, index) => {
    const row = returned[index];
    if (row === undefined) {
      throw new Error(
        `queue_events returned ${String(returned.length)} rows for ${String(provisional.length)} events.`,
      );
    }
    return materialise(event, row.id as QueueEventId, Number(row.seq), sessionId);
  });
}

/**
 * Writes every row derived from a session's log: `queue_state`,
 * `bookings.status` and the projections on `sessions`.
 *
 * @param now the instant the whole seed run is anchored to, so a projected end
 *   is consistent across a reset rather than drifting by the time each module
 *   took to run.
 */
export async function writeProjections(
  client: Client,
  seed: QueueSeed,
  events: readonly QueueEvent[],
  now: Timestamp,
): Promise<QueueState> {
  const state = replay(seed, events);
  const projection = project(state);

  await client.query(
    `INSERT INTO queue_state
       (session_id, now_serving_booking_id, now_serving_serial, waiting_count,
        late_count, no_show_count, done_count, avg_consult_seconds,
        projected_end, rebuilt_from_seq)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (session_id) DO UPDATE SET
       now_serving_booking_id = excluded.now_serving_booking_id,
       now_serving_serial     = excluded.now_serving_serial,
       waiting_count          = excluded.waiting_count,
       late_count             = excluded.late_count,
       no_show_count          = excluded.no_show_count,
       done_count             = excluded.done_count,
       avg_consult_seconds    = excluded.avg_consult_seconds,
       projected_end          = excluded.projected_end,
       rebuilt_from_seq       = excluded.rebuilt_from_seq`,
    [
      projection.sessionId,
      projection.nowServingBookingId,
      projection.nowServingSerial,
      projection.waitingCount,
      projection.lateCount,
      projection.noShowCount,
      projection.doneCount,
      projection.avgConsultSeconds,
      state.status === 'ended' ? null : projectedEnd(state, now),
      projection.rebuiltFromSeq,
    ],
  );

  await client.query(
    `UPDATE sessions
        SET status              = $2,
            actual_start        = $3,
            actual_end          = $4,
            delay_minutes       = $5,
            avg_consult_seconds = $6,
            last_event_seq      = $7
      WHERE id = $1`,
    [
      state.plan.sessionId,
      state.status,
      state.doctorArrivedAt,
      state.endedAt,
      state.delayMinutes,
      projection.avgConsultSeconds,
      state.lastSeq,
    ],
  );

  // One statement for every booking in the session. `bookings.status` is
  // documented as maintained from the log by `trg_booking_status_from_events`
  // (migration 0013, not yet written), so until that trigger exists the seed
  // writes what the reducer derived — the same values, from the same function.
  const settled = state.entries.map((entry) => [
    entry.bookingId,
    entry.status,
    entry.calledAt,
    entry.doneAt,
    entry.arrivedAt,
    entry.quotedWaitMinutes,
    entry.consultSeconds,
    entry.cancelled?.reason ?? null,
  ]);

  if (settled.length > 0) {
    const tuples = settled
      .map((_, index) => {
        const base = index * 8;
        return `($${String(base + 1)}::uuid, $${String(base + 2)}::booking_status, $${String(base + 3)}::timestamptz, $${String(base + 4)}::timestamptz, $${String(base + 5)}::timestamptz, $${String(base + 6)}::integer, $${String(base + 7)}::integer, $${String(base + 8)}::text)`;
      })
      .join(', ');

    // The same COALESCE the API's `saveProjections` uses: `seed_04_history`
    // writes its own Bangla reason on the row while the event behind it
    // carries none, and overwriting that with null would fail
    // `bookings_cancelled_has_reason`.
    await client.query(
      `UPDATE bookings AS b
          SET status           = v.status,
              called_at        = v.called_at,
              done_at          = v.done_at,
              arrived_at       = v.arrived_at,
              quoted_wait_minutes = v.quoted_wait_minutes,
              consult_seconds  = v.consult_seconds,
              cancelled_reason = COALESCE(v.cancelled_reason, b.cancelled_reason)
         FROM (VALUES ${tuples})
              AS v (id, status, called_at, done_at, arrived_at, quoted_wait_minutes,
                    consult_seconds, cancelled_reason)
        WHERE b.id = v.id`,
      settled.flat(),
    );
  }

  return state;
}

/** Fills in the three fields the database owns. */
function materialise(
  draft: EventDraft,
  id: QueueEventId,
  seq: number,
  sessionId: SessionId,
): QueueEvent {
  return { ...draft, id, seq, sessionId };
}

/**
 * Splits a `QueueActor` into the three columns `queue_events` carries
 * (`queue_events_single_actor`, `queue_events_role_requires_staff`).
 *
 * A guest acts on their own booking, which the log already names in
 * `booking_id` — there is no guest column and inventing one would put a guest
 * identity where a staff or user id belongs.
 */
function actorColumns(event: QueueEvent): {
  staffId: string | null;
  userId: string | null;
  role: string | null;
} {
  switch (event.actor.kind) {
    case 'staff':
      return { staffId: event.actor.staffUserId, userId: null, role: event.actor.role };
    case 'patient':
      return { staffId: null, userId: event.actor.userId, role: null };
    case 'guest':
    case 'system':
      return { staffId: null, userId: null, role: null };
  }
}
