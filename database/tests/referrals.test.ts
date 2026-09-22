/**
 * `referrals` (migrations 0008, 0017; `FR-EMG-07..09`).
 *
 * The stance `emergency.test.ts` takes: a referral is two ERs under pressure
 * talking about one person, so what a row is *allowed to say* — who asked
 * whom, for what, and where the timeline has got to — is enforced by the
 * database. Each test attempts something a hurried console could write and
 * requires the schema to refuse it.
 */

import { describe, expect, it } from 'vitest';

import { expectRejection, withRollback } from './support/database.js';
import { insertGraph } from './support/fixtures.js';

import type { Client } from 'pg';

type Fields = Record<string, string | number | null>;

async function insertRow(client: Client, table: string, row: Fields): Promise<string> {
  const columns = Object.keys(row);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO ${table} (${columns.join(', ')})
     VALUES (${columns.map((_, index) => `$${String(index + 1)}`).join(', ')})
     RETURNING id`,
    columns.map((column) => row[column] ?? null),
  );
  const inserted = rows[0];
  if (inserted === undefined) throw new Error(`${table} insert failed`);
  return inserted.id;
}

/** Somebody in an ER with a token: the only kind of case that is referred. */
async function caseInEr(client: Client, hospitalId: string, token: string): Promise<string> {
  return await insertRow(client, 'emergency_cases', {
    hospital_id: hospitalId,
    problem_type: 'cardiac',
    state: 'arrived',
    arrived_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    token_label: token,
  });
}

interface Pair {
  readonly from: string;
  readonly to: string;
  readonly caseId: string;
}

async function twoErs(client: Client): Promise<Pair> {
  const from = await insertGraph(client, 1);
  const to = await insertGraph(client, 2);
  const caseId = await caseInEr(client, from.hospitalId, 'ER-1');
  return { from: from.hospitalId, to: to.hospitalId, caseId };
}

/** A referral just sent, plus whatever the test says. */
async function insertReferral(client: Client, pair: Pair, fields: Fields = {}): Promise<string> {
  return await insertRow(client, 'referrals', {
    from_hospital_id: pair.from,
    to_hospital_id: pair.to,
    emergency_case_id: pair.caseId,
    required_capability: 'cardiac',
    state: 'sent',
    ...fields,
  });
}

const minutesAgo = (minutes: number): string =>
  new Date(Date.now() - minutes * 60_000).toISOString();

describe('what a referral asks for (migration 0017)', () => {
  it('asks for a bed alone — "our ICU is full" names no capability', async () => {
    await withRollback(async (client) => {
      const pair = await twoErs(client);
      await insertReferral(client, pair, { required_capability: null, required_bed_kind: 'icu' });
    });
  });

  it('refuses a referral that asks for nothing', async () => {
    await withRollback(async (client) => {
      const pair = await twoErs(client);
      const nothing = await expectRejection(client, () =>
        insertReferral(client, pair, { required_capability: null, required_bed_kind: null }),
      );
      expect(nothing.constraint).toBe('referrals_asks_for_something');
    });
  });

  it('refers a case only from the hospital it is at', async () => {
    await withRollback(async (client) => {
      const pair = await twoErs(client);
      const elsewhere = await expectRejection(client, () =>
        insertReferral(client, { ...pair, from: pair.to, to: pair.from }),
      );
      expect(elsewhere.constraint).toBe('referrals_case_at_sender');
    });
  });
});

describe('one person, one hospital asked at a time', () => {
  it('refuses a second open referral of the same case', async () => {
    await withRollback(async (client) => {
      const pair = await twoErs(client);
      await insertReferral(client, pair);
      const twice = await expectRejection(client, () => insertReferral(client, pair));
      expect(twice.constraint).toBe('referrals_one_open_per_case');
    });
  });

  it('asks the next hospital once the first has said no', async () => {
    await withRollback(async (client) => {
      const pair = await twoErs(client);
      const now = new Date().toISOString();
      await insertReferral(client, pair, {
        state: 'declined',
        seen_at: now,
        responded_at: now,
        closed_at: now,
        decline_reason: 'কার্ডিয়াক টিম নেই',
      });
      await insertReferral(client, pair);
    });
  });

  it('finds the referral a replayed send already made', async () => {
    await withRollback(async (client) => {
      const pair = await twoErs(client);
      const key = 'referral-0123456789ab';
      await insertReferral(client, pair, { idempotency_key: key });

      const other = await caseInEr(client, pair.from, 'ER-2');
      const replay = await expectRejection(client, () =>
        insertReferral(client, { ...pair, caseId: other }, { idempotency_key: key }),
      );
      expect(replay.constraint).toBe('referrals_idempotency_key');
    });
  });
});

describe('the timeline carries its stamps (FR-EMG-08)', () => {
  it('refuses an answer nobody saw, and a seen state with no time', async () => {
    await withRollback(async (client) => {
      const pair = await twoErs(client);

      const unseen = await expectRejection(client, () =>
        insertReferral(client, pair, { state: 'accepted', responded_at: minutesAgo(0) }),
      );
      expect(unseen.constraint).toBe('referrals_seen_stamped');

      const unanswered = await expectRejection(client, () =>
        insertReferral(client, pair, { state: 'accepted', seen_at: minutesAgo(0) }),
      );
      expect(unanswered.constraint).toBe('referrals_answer_stamped');
    });
  });

  it('keeps a reason for a decline and nothing else', async () => {
    await withRollback(async (client) => {
      const pair = await twoErs(client);
      const stray = await expectRejection(client, () =>
        insertReferral(client, pair, { decline_reason: 'শয্যা নেই' }),
      );
      expect(stray.constraint).toBe('referrals_reason_only_when_declined');
    });
  });

  it('arrives only with the case the receiving ER opened, at the receiving ER', async () => {
    await withRollback(async (client) => {
      const pair = await twoErs(client);
      const answered = {
        sent_at: minutesAgo(45),
        seen_at: minutesAgo(40),
        responded_at: minutesAgo(35),
      };

      const noCase = await expectRejection(client, () =>
        insertReferral(client, pair, {
          ...answered,
          state: 'arrived',
          arrived_at: minutesAgo(0),
          closed_at: minutesAgo(0),
        }),
      );
      expect(noCase.constraint).toBe('referrals_arrival_complete');

      // A case at the sending ER cannot be the arrival.
      const wrongEr = await caseInEr(client, pair.from, 'ER-3');
      const misfiled = await expectRejection(client, () =>
        insertReferral(client, pair, {
          ...answered,
          state: 'arrived',
          arrived_at: minutesAgo(0),
          closed_at: minutesAgo(0),
          arrived_case_id: wrongEr,
        }),
      );
      expect(misfiled.constraint).toBe('referrals_arrival_at_receiver');

      const received = await caseInEr(client, pair.to, 'ER-1');
      await insertReferral(client, pair, {
        ...answered,
        state: 'arrived',
        arrived_at: minutesAgo(0),
        closed_at: minutesAgo(0),
        arrived_case_id: received,
      });
    });
  });

  it('is open exactly while somebody waits on it', async () => {
    await withRollback(async (client) => {
      const pair = await twoErs(client);
      const openButClosed = await expectRejection(client, () =>
        insertReferral(client, pair, { closed_at: minutesAgo(0) }),
      );
      expect(openButClosed.constraint).toBe('referrals_closed_when_final');

      const finalButOpen = await expectRejection(client, () =>
        insertReferral(client, pair, { state: 'cancelled' }),
      );
      expect(finalButOpen.constraint).toBe('referrals_closed_when_final');
    });
  });

  it('refuses a timeline that runs backwards', async () => {
    await withRollback(async (client) => {
      const pair = await twoErs(client);
      const backwards = await expectRejection(client, () =>
        insertReferral(client, pair, {
          state: 'seen',
          sent_at: minutesAgo(0),
          seen_at: minutesAgo(10),
        }),
      );
      expect(backwards.constraint).toBe('referrals_timeline_in_order');
    });
  });
});

describe('a referred case (migration 0017)', () => {
  it('is somebody who arrived first', async () => {
    await withRollback(async (client) => {
      const graph = await insertGraph(client);
      const never = await expectRejection(client, () =>
        insertRow(client, 'emergency_cases', {
          hospital_id: graph.hospitalId,
          problem_type: 'burn',
          state: 'referred',
          closed_at: minutesAgo(0),
        }),
      );
      expect(never.constraint).toBe('emergency_cases_referred_after_arrival');
    });
  });
});
