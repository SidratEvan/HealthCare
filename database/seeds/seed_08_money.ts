/**
 * `FR-PAY-*` — the money every seeded booking produced (step 18).
 *
 * **It runs last, and that is the whole reason it is its own module.** The
 * first attempt put this inside `seed_04_history`, which writes the past
 * three weeks of bookings — and seed_04 runs before `seed_05_beds` and
 * `seed_07_demo_live`. So the pitch session's own bookings, the ones a demo
 * actually shows, had no payments at all: 367 rows where there should have
 * been 919. Money is written after every booking exists, or it is written
 * about only some of them.
 *
 * ## What it writes
 *
 * A `payments` row for every booking with a payer (`FR-PAY-01`), and the
 * counter shifts a reception desk closes at the end of a day (`FR-REC-23`).
 *
 * ## What it does not write
 *
 * **No subscriptions and no invoices.** Their tables exist because
 * DATABASE.md §2.6 specifies them, and what a hospital is charged is
 * negotiated per agreement and lives outside this repository (CLAUDE.md
 * §1.1). Seeding a plan and a monthly price would be inventing the one thing
 * the repository is told not to hold.
 *
 * **No doctor-absence refunds.** `FR-PAY-07` raises those when a session
 * ends, and the product can perform it live — seeding one would be demo data
 * standing in for behaviour that actually works.
 */

import { time, type Timestamp } from '@platform/domain';

import { labelBn } from './lib/demo.js';
import { insertRows } from './lib/insert.js';
import { facilityIds, staffByRole } from './lib/lookup.js';

import type { Rng } from './lib/random.js';
import type { SeedContext, SeedModule, SeedSummary } from './lib/runner.js';
import type { Client } from 'pg';

export const seed08Money: SeedModule = {
  name: 'seed_08_money',
  title: 'payments against every booking, and the counter shifts',
  requirements: ['FR-PAY-01', 'FR-PAY-05', 'FR-REC-23'],
  writes: ['payments', 'counter_shifts'],

  async run({ client, now, rng, log }: SeedContext): Promise<SeedSummary> {
    const money = await insertPayments(client, now, rng.stream('money'));

    log(
      `      ${String(money.payments)} payments (${String(money.refunds)} refunded), ` +
        `${String(money.shifts)} counter shifts`,
    );
    log('      no subscriptions or invoices: what a hospital is charged is not in this repo');

    return { payments: money.payments, counter_shifts: money.shifts };
  },
};

/**
 * How the seeded population pays.
 *
 * Roughly what a Dhaka hospital actually sees: most people still pay at the
 * counter, bKash is the common digital method and Nagad trails it, and cards
 * are rare outside the private hospitals. Declared rather than uniform,
 * because a settlement report split evenly four ways would look like test
 * data to anybody who has run a counter (`FR-PAY-05`).
 */
const PAYMENT_MIX: readonly { method: string; weight: number }[] = [
  { method: 'at_hospital', weight: 46 },
  { method: 'bkash', weight: 31 },
  { method: 'nagad', weight: 16 },
  { method: 'card', weight: 7 },
];

/** How many of the online payments were refunded, and why. */
const REFUND_RATE = 0.04;

/**
 * A `payments` row for every seeded booking (`FR-PAY-01`, `FR-PAY-05`).
 *
 * ## Why every booking and not only the paid ones
 *
 * A settlement counts bookings *and* collections, and the gap between them is
 * the figure an administrator cares about. A seed that wrote payments only
 * where money moved would make that gap zero and the report meaningless.
 *
 * ## What each state means here
 *
 * - **`paid`** — money in, online or at the counter. The counter ones carry
 *   `at_hospital` or `cash`, which the settlement reports beside the payout
 *   rather than inside it.
 * - **`pending`** — a booking that chose to pay at the hospital and has not
 *   been seen yet. That is the honest state for today's queue.
 * - **`refunded` / `partially_refunded`** — a few cancellations, under the
 *   hospital's own policy, so the refund columns are not always zero.
 *
 * `platform_fee_poisha` is whatever `PLATFORM_FEE_POISHA` is, which is 0
 * everywhere this repository configures. The column is itemised as zero
 * rather than hidden (`FR-PAY-04`).
 */
async function insertPayments(
  client: Client,
  now: Timestamp,
  rng: Rng,
): Promise<{ payments: number; refunds: number; shifts: number }> {
  const bookings = await loadBookingsForPayment(client);
  if (bookings.length === 0) return { payments: 0, refunds: 0, shifts: 0 };

  const rows: unknown[][] = [];
  let refunds = 0;

  for (const booking of bookings) {
    const method = weightedMethod(rng);
    const cash = method === 'at_hospital';

    // Somebody who has not been seen yet and chose the counter has not paid.
    const settledAlready = !cash || booking.status === 'done';

    // A cancellation is the only thing refunded here: a doctor-absence refund
    // is raised by the product when a session ends, and seeding one would be
    // demo data standing in for behaviour the demo can actually perform.
    const refundable =
      settledAlready && !cash && booking.status === 'cancelled' && rng.chance(REFUND_RATE * 8);

    const amount = booking.feePoisha;
    const paidAt = settledAlready ? time.addMinutes(booking.bookedAt, rng.int(0, 4)) : null;

    let state = settledAlready ? 'paid' : 'pending';
    let refunded = 0;
    let refundReason: string | null = null;
    let refundedAt: Timestamp | null = null;

    if (refundable) {
      // The hospital's own terms decided this when it happened; the seed
      // records the outcome rather than recomputing a rule.
      const full = rng.chance(0.6);
      refunded = full ? amount : Math.round(amount / 2);
      state = full ? 'refunded' : 'partially_refunded';
      refundReason = 'patient_cancelled';
      refundedAt = time.addMinutes(paidAt ?? booking.bookedAt, rng.int(60, 2_880));
      refunds += 1;
    }

    rows.push([
      booking.id,
      booking.userId,
      booking.guestId,
      amount,
      0,
      method,
      state,
      // Unique per row, and not a uuid on purpose: these were not made by a
      // console, and a reader should be able to tell a seeded key from one a
      // client minted (`FR-PAY-06`).
      `seed:${booking.id}`,
      paidAt,
      refunded,
      refundReason,
      refundedAt,
      booking.bookedAt,
    ]);
  }

  const inserted = await insertRows<{ id: string }>(
    client,
    'payments',
    {
      columns: [
        'booking_id',
        'payer_user_id',
        'payer_guest_id',
        'amount_poisha',
        'platform_fee_poisha',
        'method',
        'state',
        'idempotency_key',
        'paid_at',
        'refunded_poisha',
        'refund_reason',
        'refunded_at',
        'created_at',
      ],
    },
    rows,
  );

  const shifts = await insertCounterShifts(client, now, rng);

  return { payments: inserted.length, refunds, shifts };
}

/** A booking, with everything a payment row needs. */
interface BookingForPayment {
  readonly id: string;
  readonly feePoisha: number;
  readonly status: string;
  readonly userId: string | null;
  readonly guestId: string | null;
  readonly bookedAt: Timestamp;
}

async function loadBookingsForPayment(client: Client): Promise<BookingForPayment[]> {
  const { rows } = await client.query<{
    id: string;
    fee_poisha: number;
    status: string;
    booked_by_user_id: string | null;
    booked_by_guest_id: string | null;
    created_at: Date;
  }>(
    `SELECT b.id, b.fee_poisha, b.status::text AS status,
            b.booked_by_user_id, b.booked_by_guest_id, b.created_at
       FROM bookings b
      WHERE b.deleted_at IS NULL
        -- payments_one_payer needs exactly one. A walk-in added at the
        -- counter has neither, and is paid for in cash off-system.
        AND num_nonnulls(b.booked_by_user_id, b.booked_by_guest_id) = 1
      ORDER BY b.created_at`,
  );

  return rows.map((row) => ({
    id: row.id,
    feePoisha: row.fee_poisha,
    status: row.status,
    userId: row.booked_by_user_id,
    guestId: row.booked_by_guest_id,
    bookedAt: row.created_at.toISOString() as Timestamp,
  }));
}

function weightedMethod(rng: Rng): string {
  const total = PAYMENT_MIX.reduce((sum, entry) => sum + entry.weight, 0);
  let point = rng.int(1, total);
  for (const entry of PAYMENT_MIX) {
    point -= entry.weight;
    if (point <= 0) return entry.method;
  }
  return 'at_hospital';
}

/**
 * Yesterday's closed counter shifts and today's open ones (`FR-REC-23`).
 *
 * One of them is deliberately short. `expected_poisha` is what the system
 * says passed over the counter and `collected_poisha` is what the person
 * counted; a demo where they always match would hide the only thing this
 * table is for, which is finding the shift that cannot be reconciled.
 */
async function insertCounterShifts(client: Client, now: Timestamp, rng: Rng): Promise<number> {
  const receptionists = await staffByRole(client, 'receptionist');
  if (receptionists.size === 0) return 0;

  const facilities = await facilityIds(client);
  const rows: unknown[][] = [];

  for (const [slug, staffUserId] of [...receptionists].sort(([a], [b]) => a.localeCompare(b))) {
    const hospitalId = facilities.get(slug);
    if (hospitalId === undefined) continue;

    // Yesterday, closed and counted.
    const openedYesterday = time.addMinutes(now, -(rng.int(20, 26) * 60));
    const expected = rng.int(40, 180) * 50_000;
    // Most reconcile exactly; one in four is out by a note or two, which is
    // what a variance note is for.
    const shortfall = rng.chance(0.25) ? rng.int(1, 4) * 50_000 : 0;

    rows.push([
      hospitalId,
      'C1',
      staffUserId,
      openedYesterday,
      time.addMinutes(openedYesterday, 8 * 60),
      expected,
      expected - shortfall,
      shortfall === 0 ? null : labelBn('মিলছে না — হিসাব দেখা হচ্ছে'),
    ]);

    // Today, still open: nothing counted yet, which is the honest state.
    rows.push([
      hospitalId,
      'C1',
      staffUserId,
      time.addMinutes(now, -rng.int(60, 240)),
      null,
      rng.int(10, 60) * 50_000,
      null,
      null,
    ]);
  }

  const inserted = await insertRows<{ id: string }>(
    client,
    'counter_shifts',
    {
      columns: [
        'hospital_id',
        'counter_code',
        'staff_user_id',
        'opened_at',
        'closed_at',
        'expected_poisha',
        'collected_poisha',
        'variance_note',
      ],
    },
    rows,
  );

  return inserted.length;
}
