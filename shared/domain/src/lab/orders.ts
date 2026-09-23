/**
 * The test order state machine (`FR-LAB-01`, `FR-LAB-02`, `APP_FLOW.md` B5).
 *
 * One definition of what may happen to a test order, used by the API as its
 * guard and by the lab console to apply a state button before the server has
 * answered — the arrangement `referrals.ts` has for a referral and `cases.ts`
 * has for an emergency case, for the same reason.
 *
 * No I/O.
 *
 * ## The lifecycle
 *
 * `FR-LAB-02` gives it in one line — "ordered → sample collected → processing
 * → report ready → delivered" — and the `test_state` enum (0002) adds
 * `cancelled`:
 *
 *   ordered ──collect──→ sample_collected ──process──→ processing
 *                                                          │
 *                                                       upload
 *                                                          ↓
 *   delivered ←──(the server, on delivery)───────── report_ready
 *      │                                                   │
 *      └───────────────── cancel ──────────────────────────┘
 *                     (before a report exists)
 *
 * **It only moves forward.** A lab that mis-taps *processing* cannot walk the
 * order back to *ordered*, because the timestamps are a turnaround measurement
 * (`FR-LAB-04`) and a measurement that can be edited is not one. The schema
 * agrees: `test_orders_timeline_ordered` refuses a `ready_at` before its
 * `sample_at`. A mistake is corrected by cancelling and re-ordering, which
 * leaves both rows visible, rather than by rewriting history.
 *
 * ## `delivered` is the server's step, not a button
 *
 * Every other transition is somebody at the lab tapping something.
 * `report_ready → delivered` is not: `FR-LAB-03` says a report
 * *auto-delivers* to the patient wallet and the ordering doctor, so the step
 * is taken by the code that does the delivering, and `deliveredAt` is the
 * proof it happened. That is why `LAB_ACTIONS` has no `deliver` — a console
 * cannot claim a delivery it did not perform.
 *
 * ## Cancellation stops at the report
 *
 * An order may be cancelled while it is ordered, collected or processing — a
 * patient who did not come, a sample that spoiled. Once a report exists the
 * work is done and the result belongs to the patient (`FR-PAT-60`), so
 * cancelling is refused. Withdrawing a report is a clinical act nobody has
 * specified, and it is not invented here.
 *
 * ## Replays
 *
 * As with a referral: an action whose outcome is already the order's state is
 * a replay from an offline outbox or a second tap on a slow connection
 * (`labOrderAlreadyApplied`), answered as a success without writing.
 */

import type { TestState } from '../types/enums.js';
import type { Timestamp } from '../types/ids.js';

/** The states the lab still has work to do on. */
export const OPEN_TEST_STATES = ['ordered', 'sample_collected', 'processing'] as const;

/** The states a report has been produced for. */
export const REPORTED_TEST_STATES = ['report_ready', 'delivered'] as const;

/**
 * What a console can do to an order once it exists.
 *
 * `deliver` is deliberately absent — see the header. So is anything that
 * moves an order backwards.
 */
export const LAB_ACTIONS = ['collect', 'process', 'ready', 'cancel'] as const;
export type LabAction = (typeof LAB_ACTIONS)[number];

/** The state each action leaves the order in. */
export const LAB_ACTION_RESULT: Readonly<Record<LabAction, TestState>> = {
  collect: 'sample_collected',
  process: 'processing',
  ready: 'report_ready',
  cancel: 'cancelled',
};

/**
 * How far along each state is, so "forward only" is one comparison rather
 * than a table of pairs. `cancelled` is off the line and is handled by name.
 */
const PROGRESS: Readonly<Record<TestState, number>> = {
  ordered: 0,
  sample_collected: 1,
  processing: 2,
  report_ready: 3,
  delivered: 4,
  cancelled: -1,
};

/** A test order as both consoles and the wallet show it. */
export interface TestOrderView {
  readonly id: string;
  readonly hospitalId: string;
  readonly patientId: string;
  /** The consultation it came out of, when a doctor ordered it (`FR-DOC-06`). */
  readonly visitId: string | null;
  readonly testCode: string;
  readonly testName: string;
  readonly state: TestState;
  /** What the patient is charged, integer poisha (CLAUDE.md §7). */
  readonly pricePoisha: number;
  readonly orderedAt: Timestamp;
  readonly sampleAt: Timestamp | null;
  readonly readyAt: Timestamp | null;
  readonly deliveredAt: Timestamp | null;
  /** The report, once the lab has uploaded one (`FR-LAB-03`). */
  readonly report: TestReportView | null;
}

/** A report file, as a console lists it and a wallet opens it. */
export interface TestReportView {
  readonly id: string;
  readonly fileType: string | null;
  readonly uploadedAt: Timestamp;
  /** Null until it reached the wallet — the figure that makes `FR-LAB-03` checkable. */
  readonly deliveredToWalletAt: Timestamp | null;
}

export type LabGuardCode = 'WRONG_STATE' | 'REPORT_EXISTS' | 'NO_REPORT';

export type LabGuardResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: LabGuardCode; readonly detail: string };

const ALLOWED = { ok: true } as const;

function deny(code: LabGuardCode, detail: string): LabGuardResult {
  return { ok: false, code, detail };
}

export function isOpenTestOrder(state: TestState): boolean {
  return (OPEN_TEST_STATES as readonly TestState[]).includes(state);
}

export function hasReport(state: TestState): boolean {
  return (REPORTED_TEST_STATES as readonly TestState[]).includes(state);
}

/**
 * May the lab take this step, now?
 *
 * Forward only, one step at a time. Skipping is refused as loudly as going
 * backwards: an order that jumped from *ordered* to *report ready* has no
 * `sample_at`, and its turnaround would be measured from nothing.
 */
export function canActOnTestOrder(
  current: Pick<TestOrderView, 'state'>,
  action: LabAction,
): LabGuardResult {
  const { state } = current;

  if (action === 'cancel') {
    if (hasReport(state)) {
      return deny(
        'REPORT_EXISTS',
        'A test with a report cannot be cancelled; the result is the patient’s.',
      );
    }
    return isOpenTestOrder(state)
      ? ALLOWED
      : deny('WRONG_STATE', `A ${state} test order cannot be cancelled.`);
  }

  const target = LAB_ACTION_RESULT[action];
  const from = PROGRESS[state];
  const to = PROGRESS[target];

  if (from < 0) {
    return deny('WRONG_STATE', 'A cancelled test order cannot be worked on.');
  }
  if (to <= from) {
    return deny(
      'WRONG_STATE',
      `A ${state} test order cannot go back to ${target}; cancel and re-order instead.`,
    );
  }
  if (to > from + 1) {
    return deny('WRONG_STATE', `A ${state} test order has to be ${previousOf(target)} first.`);
  }

  return ALLOWED;
}

/** The state immediately before this one, for the "one step at a time" message. */
function previousOf(state: TestState): TestState {
  const order: readonly TestState[] = [
    'ordered',
    'sample_collected',
    'processing',
    'report_ready',
    'delivered',
  ];
  const index = order.indexOf(state);
  return index > 0 ? (order[index - 1] as TestState) : 'ordered';
}

/**
 * May a report be uploaded against this order (`FR-LAB-03`)?
 *
 * A report is what makes an order *report ready*, so it is uploaded while the
 * order is being processed — or against one already ready, which is a lab
 * replacing a file it just uploaded. Never against an order whose sample was
 * never taken, and never against a cancelled one.
 */
export function canUploadReport(current: Pick<TestOrderView, 'state'>): LabGuardResult {
  switch (current.state) {
    case 'processing':
    case 'report_ready':
      return ALLOWED;
    case 'delivered':
      return deny('WRONG_STATE', 'This report has already reached the patient.');
    case 'ordered':
    case 'sample_collected':
      return deny('WRONG_STATE', 'Take the sample and start processing before uploading a report.');
    case 'cancelled':
      return deny('WRONG_STATE', 'A cancelled test order cannot take a report.');
  }
}

/**
 * May this order be delivered to the wallet?
 *
 * The server's own check before it takes the one step no console may take.
 */
export function canDeliverReport(current: Pick<TestOrderView, 'state' | 'report'>): LabGuardResult {
  if (current.report === null) {
    return deny('NO_REPORT', 'There is no report to deliver.');
  }
  return current.state === 'report_ready'
    ? ALLOWED
    : deny('WRONG_STATE', `A ${current.state} test order is not ready to deliver.`);
}

/**
 * True when the action's outcome is already the order's state — a replay from
 * an offline outbox, or a second tap on a slow connection.
 *
 * A *delivered* order counts as already-collected, already-processed and
 * already-ready: a console whose outbox held three stale taps should find all
 * three satisfied rather than three refusals.
 */
export function labOrderAlreadyApplied(
  current: Pick<TestOrderView, 'state'>,
  action: LabAction,
): boolean {
  if (action === 'cancel') return current.state === 'cancelled';
  const from = PROGRESS[current.state];
  if (from < 0) return false;
  return from >= PROGRESS[LAB_ACTION_RESULT[action]];
}

/** One action as the lab console applies it before the server answers. */
export interface LocalLabChange {
  readonly orderId: string;
  readonly action: LabAction;
  readonly at: Timestamp;
}

/**
 * The order with one change applied — the console's optimistic update.
 *
 * Unchanged when the guard refuses, as `applyLocalReferral` is. The stamps it
 * writes are the same ones the server will write, so a reconciliation after
 * the round trip moves nothing on screen.
 */
export function applyLocalLabChange(current: TestOrderView, change: LocalLabChange): TestOrderView {
  if (!canActOnTestOrder(current, change.action).ok) return current;

  switch (change.action) {
    case 'collect':
      return { ...current, state: 'sample_collected', sampleAt: change.at };
    case 'process':
      return { ...current, state: 'processing' };
    case 'ready':
      return { ...current, state: 'report_ready', readyAt: change.at };
    case 'cancel':
      return { ...current, state: 'cancelled' };
  }
}

/**
 * The lab's queue, in the order somebody at a bench works through it
 * (`FR-LAB-01`, "test order queue").
 *
 * Open orders first and oldest first within them, because a turnaround clock
 * is running on every one of them (`FR-LAB-04`) and the one that has been
 * waiting longest is the one about to embarrass the hospital. Reported and
 * cancelled orders follow, newest first, which is the order somebody looking
 * for what they just did wants.
 */
export function sortLabQueue(orders: readonly TestOrderView[]): TestOrderView[] {
  return [...orders].sort((a, b) => {
    const aOpen = isOpenTestOrder(a.state);
    const bOpen = isOpenTestOrder(b.state);
    if (aOpen !== bOpen) return aOpen ? -1 : 1;

    const aTime = Date.parse(a.orderedAt);
    const bTime = Date.parse(b.orderedAt);
    return aOpen ? aTime - bTime : bTime - aTime;
  });
}
