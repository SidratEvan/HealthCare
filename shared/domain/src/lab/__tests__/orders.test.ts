import { describe, expect, it } from 'vitest';

import {
  applyLocalLabChange,
  canActOnTestOrder,
  canDeliverReport,
  canUploadReport,
  hasReport,
  isOpenTestOrder,
  labOrderAlreadyApplied,
  sortLabQueue,
  LAB_ACTIONS,
  LAB_ACTION_RESULT,
  type LabAction,
  type TestOrderView,
} from '../orders.js';

import type { TestState } from '../../types/enums.js';
import type { Timestamp } from '../../types/ids.js';

const NOW = '2026-09-22T10:00:00.000Z' as Timestamp;
const at = (minutes: number): Timestamp =>
  new Date(Date.parse(NOW) + minutes * 60_000).toISOString() as Timestamp;

function order(overrides: Partial<TestOrderView> = {}): TestOrderView {
  return {
    id: 'order-1',
    hospitalId: 'hospital-shapla',
    patientId: 'patient-1',
    visitId: 'visit-1',
    testCode: 'CBC',
    testName: 'সম্পূর্ণ রক্ত পরীক্ষা',
    state: 'ordered',
    pricePoisha: 45_000,
    orderedAt: NOW,
    sampleAt: null,
    readyAt: null,
    deliveredAt: null,
    report: null,
    ...overrides,
  };
}

describe('the lifecycle FR-LAB-02 names', () => {
  it('walks ordered → sample_collected → processing → report_ready', () => {
    let current = order();

    for (const [action, expected] of [
      ['collect', 'sample_collected'],
      ['process', 'processing'],
      ['ready', 'report_ready'],
    ] as const) {
      expect(canActOnTestOrder(current, action).ok).toBe(true);
      current = applyLocalLabChange(current, { orderId: current.id, action, at: at(10) });
      expect(current.state).toBe<TestState>(expected);
    }
  });

  it('stamps the two times the turnaround is measured between', () => {
    const collected = applyLocalLabChange(order(), {
      orderId: 'order-1',
      action: 'collect',
      at: at(30),
    });
    expect(collected.sampleAt).toBe(at(30));

    const ready = applyLocalLabChange(
      applyLocalLabChange(collected, { orderId: 'order-1', action: 'process', at: at(35) }),
      { orderId: 'order-1', action: 'ready', at: at(90) },
    );
    expect(ready.readyAt).toBe(at(90));
  });
});

describe('it only moves forward', () => {
  it('refuses to walk an order back to an earlier state', () => {
    const result = canActOnTestOrder(order({ state: 'processing' }), 'collect');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('WRONG_STATE');
      expect(result.detail).toContain('cancel and re-order');
    }
  });

  it('refuses to skip a state, so no order is reported without a sample', () => {
    const result = canActOnTestOrder(order({ state: 'ordered' }), 'ready');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain('processing');
  });

  it('leaves the order untouched when the guard refuses', () => {
    const current = order({ state: 'processing' });
    expect(applyLocalLabChange(current, { orderId: 'order-1', action: 'collect', at: at(1) })).toBe(
      current,
    );
  });

  it('refuses every action on a cancelled order', () => {
    for (const action of LAB_ACTIONS) {
      expect(canActOnTestOrder(order({ state: 'cancelled' }), action).ok).toBe(false);
    }
  });
});

describe('delivered is the server’s step, not a button', () => {
  it('is not in the actions a console may send', () => {
    expect(LAB_ACTIONS as readonly string[]).not.toContain('deliver');
    expect(Object.values(LAB_ACTION_RESULT)).not.toContain('delivered');
  });

  it('delivers only a report_ready order that has a report', () => {
    const ready = order({ state: 'report_ready' });
    const withReport = order({
      state: 'report_ready',
      readyAt: at(90),
      report: { id: 'report-1', fileType: 'application/pdf', uploadedAt: at(90), deliveredToWalletAt: null },
    });

    const noReport = canDeliverReport(ready);
    expect(noReport.ok).toBe(false);
    if (!noReport.ok) expect(noReport.code).toBe('NO_REPORT');

    expect(canDeliverReport(withReport).ok).toBe(true);
    expect(canDeliverReport({ ...withReport, state: 'processing' }).ok).toBe(false);
  });
});

describe('cancellation stops at the report', () => {
  it('cancels an order the lab has not reported on', () => {
    for (const state of ['ordered', 'sample_collected', 'processing'] as const) {
      expect(canActOnTestOrder(order({ state }), 'cancel').ok).toBe(true);
    }
  });

  it('refuses to cancel once a result belongs to the patient', () => {
    for (const state of ['report_ready', 'delivered'] as const) {
      const result = canActOnTestOrder(order({ state }), 'cancel');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('REPORT_EXISTS');
    }
  });
});

describe('uploading a report', () => {
  it('is allowed while processing, and again while report_ready', () => {
    expect(canUploadReport(order({ state: 'processing' })).ok).toBe(true);
    expect(canUploadReport(order({ state: 'report_ready' })).ok).toBe(true);
  });

  it('is refused before a sample was taken, after delivery, and on a cancelled order', () => {
    for (const state of ['ordered', 'sample_collected', 'delivered', 'cancelled'] as const) {
      expect(canUploadReport(order({ state })).ok).toBe(false);
    }
  });
});

describe('replays from an offline outbox', () => {
  it('treats an action whose outcome already holds as applied', () => {
    expect(labOrderAlreadyApplied(order({ state: 'sample_collected' }), 'collect')).toBe(true);
    expect(labOrderAlreadyApplied(order({ state: 'ordered' }), 'collect')).toBe(false);
    expect(labOrderAlreadyApplied(order({ state: 'cancelled' }), 'cancel')).toBe(true);
  });

  it('satisfies every stale tap an outbox held when the order ran ahead', () => {
    const delivered = order({ state: 'delivered' });
    for (const action of ['collect', 'process', 'ready'] as const) {
      expect(labOrderAlreadyApplied(delivered, action)).toBe(true);
    }
    expect(labOrderAlreadyApplied(delivered, 'cancel')).toBe(false);
  });

  it('never calls a cancelled order a replay of forward work', () => {
    for (const action of ['collect', 'process', 'ready'] as const) {
      expect(labOrderAlreadyApplied(order({ state: 'cancelled' }), action)).toBe(false);
    }
  });
});

describe('the queue a bench works through', () => {
  it('puts open orders first, oldest first, and settled ones after, newest first', () => {
    const sorted = sortLabQueue([
      order({ id: 'done-old', state: 'delivered', orderedAt: at(-300) }),
      order({ id: 'open-new', state: 'ordered', orderedAt: at(-10) }),
      order({ id: 'done-new', state: 'delivered', orderedAt: at(-30) }),
      order({ id: 'open-old', state: 'processing', orderedAt: at(-240) }),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual([
      'open-old',
      'open-new',
      'done-new',
      'done-old',
    ]);
  });

  it('does not mutate what it was given', () => {
    const input = [order({ id: 'a', state: 'delivered' }), order({ id: 'b' })];
    sortLabQueue(input);
    expect(input.map((entry) => entry.id)).toEqual(['a', 'b']);
  });
});

describe('the state predicates', () => {
  it('agree on which states are open and which have a report', () => {
    const open: TestState[] = ['ordered', 'sample_collected', 'processing'];
    for (const state of open) {
      expect(isOpenTestOrder(state)).toBe(true);
      expect(hasReport(state)).toBe(false);
    }
    for (const state of ['report_ready', 'delivered'] as const) {
      expect(isOpenTestOrder(state)).toBe(false);
      expect(hasReport(state)).toBe(true);
    }
    expect(isOpenTestOrder('cancelled')).toBe(false);
    expect(hasReport('cancelled')).toBe(false);
  });

  it('covers every action in LAB_ACTIONS with a result state', () => {
    for (const action of LAB_ACTIONS) {
      expect(LAB_ACTION_RESULT[action as LabAction]).toBeDefined();
    }
  });
});
