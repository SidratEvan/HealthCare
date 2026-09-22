/**
 * The ER console's offline outbox (`FR-OFF-01`, `SY-02`, `SY-03`).
 *
 * The protocol is the ward's (`outbox.ts`); what is proven here is that an ER
 * shift offline keeps its order across the three kinds of ER action — a walk-in
 * registered, the same person triaged, the capability list confirmed — and
 * that one action that did not arrive holds back everything after it, so a
 * triage can never reach the server before the registration it is about.
 */

import { describe, expect, it } from 'vitest';

import type { Timestamp } from '@platform/domain';

import { ErOutbox, createMemoryErStore, type PendingErAction } from '../offline/emergency.js';

import type { SendOutcome } from '../offline/outbox.js';

const WALK_IN = '00000000-0000-4000-8000-000000000001';

function walkIn(): Omit<PendingErAction, 'attempts'> {
  return {
    clientEventId: WALK_IN,
    hospitalId: 'h1',
    clientTs: '2026-09-21T10:00:01.000Z',
    method: 'POST',
    path: '/emergency/cases',
    body: { problem: 'burn', triage: null, phone: null, ageYears: 30, sex: 'male' },
    caseId: null,
    change: null,
    provisional: null,
  };
}

function triage(caseId: string, n: number): Omit<PendingErAction, 'attempts'> {
  return {
    clientEventId: `00000000-0000-4000-8000-00000000001${String(n)}`,
    hospitalId: 'h1',
    clientTs: `2026-09-21T10:00:1${String(n)}.000Z`,
    method: 'PATCH',
    path: `/emergency/cases/${caseId}`,
    body: { action: 'triage', triage: 'red' },
    caseId,
    change: {
      caseId,
      action: 'triage',
      at: '2026-09-21T10:00:10.000Z' as Timestamp,
      triage: 'red',
    },
    provisional: null,
  };
}

function capabilities(): Omit<PendingErAction, 'attempts'> {
  return {
    clientEventId: '00000000-0000-4000-8000-000000000020',
    hospitalId: 'h1',
    clientTs: '2026-09-21T10:00:20.000Z',
    method: 'PUT',
    path: '/hospitals/h1/capabilities',
    body: { capabilities: [{ kind: 'burn_unit', available: false }] },
    caseId: null,
    change: null,
    provisional: null,
  };
}

async function outboxWith(...entries: Omit<PendingErAction, 'attempts'>[]): Promise<ErOutbox> {
  const outbox = new ErOutbox(createMemoryErStore());
  for (const entry of entries) await outbox.enqueue(entry);
  return outbox;
}

describe('ErOutbox', () => {
  it('replays a shift offline in the order it happened, whatever the method', async () => {
    const outbox = await outboxWith(capabilities(), triage(WALK_IN, 0), walkIn());
    const sent: string[] = [];

    const outcome = await outbox.flush('h1', (entry) => {
      sent.push(`${entry.method} ${entry.path}`);
      return Promise.resolve<SendOutcome>({ kind: 'accepted' });
    });

    expect(sent).toEqual([
      'POST /emergency/cases',
      `PATCH /emergency/cases/${WALK_IN}`,
      'PUT /hospitals/h1/capabilities',
    ]);
    expect(outcome.offline).toBe(false);
    expect(await outbox.pending()).toEqual([]);
  });

  it('holds everything back behind an action that did not arrive (SY-01)', async () => {
    const outbox = await outboxWith(walkIn(), triage(WALK_IN, 0), capabilities());
    let calls = 0;

    const outcome = await outbox.flush('h1', () => {
      calls += 1;
      return Promise.resolve<SendOutcome>(
        calls === 1 ? { kind: 'accepted' } : { kind: 'unreachable' },
      );
    });

    expect(outcome.offline).toBe(true);
    expect(outcome.accepted).toEqual([WALK_IN]);
    const left = await outbox.pending();
    expect(left.map((entry) => entry.method)).toEqual(['PATCH', 'PUT']);
    expect(left.every((entry) => entry.attempts === 1)).toBe(true);
  });

  it('drops a refused action, reports why, and sends the next (SY-03)', async () => {
    const outbox = await outboxWith(triage('gone', 0), capabilities());

    const outcome = await outbox.flush('h1', (entry) =>
      Promise.resolve<SendOutcome>(
        entry.method === 'PATCH'
          ? { kind: 'refused', code: 'EMERGENCY_TRANSITION_INVALID', reason: 'WRONG_STATE' }
          : { kind: 'accepted' },
      ),
    );

    expect(outcome.refused).toEqual([
      {
        clientEventId: triage('gone', 0).clientEventId,
        code: 'EMERGENCY_TRANSITION_INVALID',
        reason: 'WRONG_STATE',
      },
    ]);
    expect(outcome.accepted).toHaveLength(1);
    expect(await outbox.pending()).toEqual([]);
  });

  it("flushes only this hospital's actions", async () => {
    const outbox = await outboxWith(walkIn(), { ...capabilities(), hospitalId: 'h2' });
    const sent: string[] = [];

    await outbox.flush('h1', (entry) => {
      sent.push(entry.hospitalId);
      return Promise.resolve<SendOutcome>({ kind: 'accepted' });
    });

    expect(sent).toEqual(['h1']);
    expect((await outbox.pending()).map((entry) => entry.hospitalId)).toEqual(['h2']);
  });
});
