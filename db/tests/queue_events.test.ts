/**
 * DB-P1: `queue_events` is append-only and is the only writable truth about a
 * session.
 *
 * These are the most important tests in the migration set. The product's claim
 * is that replaying a session's log reproduces its exact state, and that the
 * log is therefore what settles a dispute between a patient and a counter
 * (FR-QUE-02, FR-QUE-05). That claim is worth nothing if a row can be edited
 * or removed afterwards, so each test here attempts the edit and requires the
 * database to refuse it — not the application, the database.
 */

import { describe, expect, it } from 'vitest';

import { expectRejection, withRollback } from './support/database.js';
import { insertGraph } from './support/fixtures.js';

/** Appends one event and returns its id and seq. */
async function appendEvent(
  client: Parameters<Parameters<typeof withRollback>[0]>[0],
  sessionId: string,
  type: string,
  payload: Record<string, unknown> = {},
  bookingId: string | null = null,
): Promise<{ id: string; seq: string }> {
  const { rows } = await client.query<{ id: string; seq: string }>(
    `INSERT INTO queue_events (session_id, type, booking_id, payload)
     VALUES ($1, $2::queue_event_type, $3, $4::jsonb)
     RETURNING id, seq`,
    [sessionId, type, bookingId, JSON.stringify(payload)],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('append failed');
  return row;
}

describe('queue_events is append-only (DB-P1)', () => {
  it('accepts an append', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const event = await appendEvent(client, graph.sessionId, 'DOCTOR_ARRIVED', {
        arrivedAt: '2026-09-17T11:12:00Z',
        minutesLate: 12,
      });

      expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(Number(event.seq)).toBeGreaterThan(0);
    });
  });

  it('refuses DELETE', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const event = await appendEvent(client, graph.sessionId, 'SESSION_OPENED');

      const error = await expectRejection(client, () =>
        client.query('DELETE FROM queue_events WHERE id = $1', [event.id]),
      );

      expect(error.message).toContain('append-only');
      expect(error.message).toContain('DELETE is not permitted');
    });
  });

  it('refuses UPDATE of a recorded fact', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const event = await appendEvent(client, graph.sessionId, 'DELAY_DECLARED', { minutes: 30 });

      const error = await expectRejection(client, () =>
        client.query(`UPDATE queue_events SET payload = '{"minutes":5}'::jsonb WHERE id = $1`, [
          event.id,
        ]),
      );

      expect(error.message).toContain('UPDATE is not permitted');
    });
  });

  it('refuses to rewrite the actor on an event', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const event = await appendEvent(client, graph.sessionId, 'SESSION_OPENED');

      const error = await expectRejection(client, () =>
        client.query('UPDATE queue_events SET actor_staff_id = $1 WHERE id = $2', [
          graph.staffUserId,
          event.id,
        ]),
      );

      expect(error.message).toContain('append-only');
    });
  });

  it('refuses TRUNCATE', async () => {
    await withRollback(async (client) => {
      const error = await expectRejection(client, () => client.query('TRUNCATE queue_events'));
      expect(error.message).toContain('TRUNCATE is not permitted');
    });
  });

  it('allows undone_by_event_id to be set exactly once, and nothing else with it', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      const original = await appendEvent(
        client,
        graph.sessionId,
        'PATIENT_CALLED',
        { bookingId: graph.bookingId, serial: 1 },
        graph.bookingId,
      );
      const undo = await appendEvent(
        client,
        graph.sessionId,
        'ACTION_UNDONE',
        { undoneEventId: original.id },
        null,
      );

      // The compensating event has landed; the original may now be marked.
      await client.query('UPDATE queue_events SET undone_by_event_id = $1 WHERE id = $2', [
        undo.id,
        original.id,
      ]);

      const { rows } = await client.query<{ undone_by_event_id: string }>(
        'SELECT undone_by_event_id FROM queue_events WHERE id = $1',
        [original.id],
      );
      expect(rows[0]?.undone_by_event_id).toBe(undo.id);

      // Once set, frozen: an undo cannot be reassigned to a different event.
      const second = await expectRejection(client, () =>
        client.query('UPDATE queue_events SET undone_by_event_id = $1 WHERE id = $2', [
          original.id,
          original.id,
        ]),
      );
      expect(second.message).toContain('append-only');

      // And it cannot be cleared to make an action look like it never happened.
      const cleared = await expectRejection(client, () =>
        client.query('UPDATE queue_events SET undone_by_event_id = NULL WHERE id = $1', [
          original.id,
        ]),
      );
      expect(cleared.message).toContain('append-only');
    });
  });

  it('keeps the undone event in history rather than removing it (GR-02)', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const original = await appendEvent(
        client,
        graph.sessionId,
        'PATIENT_NO_SHOW',
        { bookingId: graph.bookingId, graceUsedMinutes: 17 },
        graph.bookingId,
      );
      await appendEvent(client, graph.sessionId, 'ACTION_UNDONE', {
        undoneEventId: original.id,
      });

      const { rows } = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM queue_events WHERE session_id = $1',
        [graph.sessionId],
      );
      expect(rows[0]?.count).toBe('2');
    });
  });
});

describe('queue_events ordering and idempotency', () => {
  it('assigns seq monotonically within a session', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      const first = await appendEvent(client, graph.sessionId, 'SESSION_OPENED');
      const second = await appendEvent(client, graph.sessionId, 'DOCTOR_ARRIVED');
      const third = await appendEvent(
        client,
        graph.sessionId,
        'PATIENT_CALLED',
        {},
        graph.bookingId,
      );

      expect(Number(second.seq)).toBeGreaterThan(Number(first.seq));
      expect(Number(third.seq)).toBeGreaterThan(Number(second.seq));
    });
  });

  it('rejects a replayed client_event_id, which is what makes offline sync safe (FR-QUE-51)', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const clientEventId = '0192f2c0-1111-7000-8000-000000000001';

      await client.query(
        `INSERT INTO queue_events (session_id, type, client_event_id)
         VALUES ($1, 'DOCTOR_ARRIVED', $2)`,
        [graph.sessionId, clientEventId],
      );

      const error = await expectRejection(client, () =>
        client.query(
          `INSERT INTO queue_events (session_id, type, client_event_id)
           VALUES ($1, 'DOCTOR_ARRIVED', $2)`,
          [graph.sessionId, clientEventId],
        ),
      );

      expect(error.code).toBe('23505');
      expect(error.constraint).toBe('queue_events_client_event_id_key');
    });
  });

  it('allows many system events with no client_event_id', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      await appendEvent(client, graph.sessionId, 'SESSION_PAUSED', { reason: 'prayer' });
      await appendEvent(client, graph.sessionId, 'SESSION_RESUMED');
      await appendEvent(client, graph.sessionId, 'SESSION_ENDED');

      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM queue_events
         WHERE session_id = $1 AND client_event_id IS NULL`,
        [graph.sessionId],
      );
      expect(rows[0]?.count).toBe('3');
    });
  });
});

describe('queue_events records who acted (FR-QUE-04)', () => {
  it('refuses two actors on one event', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      const error = await expectRejection(client, () =>
        client.query(
          `INSERT INTO queue_events (session_id, type, actor_staff_id, actor_user_id)
           VALUES ($1, 'DOCTOR_ARRIVED', $2, $3)`,
          [graph.sessionId, graph.staffUserId, graph.userId],
        ),
      );

      expect(error.constraint).toBe('queue_events_single_actor');
    });
  });

  it('refuses a staff role without a staff actor', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      const error = await expectRejection(client, () =>
        client.query(
          `INSERT INTO queue_events (session_id, type, actor_role)
           VALUES ($1, 'DOCTOR_ARRIVED', 'receptionist')`,
          [graph.sessionId],
        ),
      );

      expect(error.constraint).toBe('queue_events_role_requires_staff');
    });
  });

  it('requires a booking on an event about one patient', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      const error = await expectRejection(client, () =>
        client.query(`INSERT INTO queue_events (session_id, type) VALUES ($1, 'PATIENT_CALLED')`, [
          graph.sessionId,
        ]),
      );

      expect(error.constraint).toBe('queue_events_patient_events_have_booking');
    });
  });

  it('requires an undo to name what it undid', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      const error = await expectRejection(client, () =>
        client.query(`INSERT INTO queue_events (session_id, type) VALUES ($1, 'ACTION_UNDONE')`, [
          graph.sessionId,
        ]),
      );

      expect(error.constraint).toBe('queue_events_undo_names_target');
    });
  });

  it('accepts a patient cancelling their own booking', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      await client.query(
        `INSERT INTO queue_events (session_id, type, booking_id, actor_user_id, payload)
         VALUES ($1, 'BOOKING_CANCELLED', $2, $3, '{}'::jsonb)`,
        [graph.sessionId, graph.bookingId, graph.userId],
      );

      const { rows } = await client.query<{ actor_user_id: string }>(
        `SELECT actor_user_id FROM queue_events
         WHERE session_id = $1 AND type = 'BOOKING_CANCELLED'`,
        [graph.sessionId],
      );
      expect(rows[0]?.actor_user_id).toBe(graph.userId);
    });
  });
});

describe('queue_state is a cache, not a source of truth (DB-P1)', () => {
  it('can be deleted without touching the log', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      await appendEvent(client, graph.sessionId, 'DOCTOR_ARRIVED');

      await client.query(
        `INSERT INTO queue_state (session_id, waiting_count, rebuilt_from_seq)
         VALUES ($1, 5, 1)`,
        [graph.sessionId],
      );
      await client.query('DELETE FROM queue_state WHERE session_id = $1', [graph.sessionId]);

      const { rows } = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM queue_events WHERE session_id = $1',
        [graph.sessionId],
      );
      expect(rows[0]?.count).toBe('1');
    });
  });

  it('refuses a half-known now-serving (FR-QUE-53)', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);

      const error = await expectRejection(client, () =>
        client.query(`INSERT INTO queue_state (session_id, now_serving_serial) VALUES ($1, 12)`, [
          graph.sessionId,
        ]),
      );

      expect(error.constraint).toBe('queue_state_now_serving_consistent');
    });
  });
});
