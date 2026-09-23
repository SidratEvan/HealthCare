/**
 * Seeded no-show recovery and post-visit feedback (`FR-ADM-03`, `FR-ADM-08`).
 *
 * Both exist so that `S-B-10` opens on rows rather than on empty states
 * (`CLAUDE.md` §5.3). Neither is written by any *runtime* path in this
 * version's history — the offer flow is step 19's own code and has only ever
 * run against today, and `FR-PAT-83`'s feedback form is not built — so a
 * dashboard whose Loss & recovery and Feedback tabs were honest about the
 * seeded database would show nothing at all on the two tabs that carry the
 * commercial argument.
 *
 * ## The offer chain is written as events, not as rows
 *
 * `slot_offers` could be filled directly and `v_no_show_loss` would read it
 * happily. It is not, because the log is the source of truth for everything
 * about a queue (`DB-P1`) and a seeded database where the table says a chair
 * was recovered and the event log does not is a database that would replay
 * into a different history than it stores. So `SLOT_OFFERED` and its outcome
 * go into the log, and the rows are written to match.
 *
 * ## The patient who accepted is already in the roster
 *
 * A standby patient who takes a chair would in life be a *new* booking. Here
 * they are one of the session's existing completed visits, reinterpreted as
 * having arrived through the list. That keeps `FR-DEM-03`'s five hundred
 * visits exactly five hundred — the count is asserted, and a recovery that
 * quietly added a five hundred and first would turn a promise about rows into
 * an approximation. What the dashboard reads is unaffected: `offers_made`,
 * `offers_accepted` and `recovered_value_poisha` are the same either way.
 */

import { id, time, type BookingId, type PatientId, type Timestamp } from '@platform/domain';

import { insertRows } from './insert.js';

import type { EventDraft } from './events.js';
import type { Rng } from './random.js';
import type { Client } from 'pg';

/** How long a seeded offer stood open, matching `SLOT_OFFER_WINDOW_MINUTES`. */
const OFFER_WINDOW_MINUTES = 10;

/** One freed chair and what became of it. */
export interface OfferPlan {
  readonly offerId: string;
  readonly freedBookingId: string;
  readonly standbyPatientId: string;
  readonly offeredAt: Timestamp;
  readonly expiresAt: Timestamp;
  /** Null when the window closed with no answer. */
  readonly acceptedBookingId: string | null;
  readonly acceptedAt: Timestamp | null;
  readonly recoveredPoisha: number | null;
}

/** What one past session's outcomes offer up, and who took it. */
export interface RecoveryInput {
  readonly rng: Rng;
  readonly feePoisha: number;
  /** Bookings that ended `no_show`, with the instant they were marked. */
  readonly freed: readonly { readonly bookingId: string; readonly markedAt: Timestamp }[];
  /** Bookings that were seen, in roster order, with the instant they were called. */
  readonly seen: readonly {
    readonly bookingId: string;
    readonly patientId: string;
    readonly calledAt: Timestamp;
  }[];
}

/**
 * Decides which freed chairs were offered, and which offers were taken.
 *
 * Roughly three in five freed chairs are offered at all, and three in four of
 * those are accepted. Neither number is a target: a demo where every offer
 * succeeds makes the acceptance rate on `S-B-10` a constant 100%, which is
 * both untrue and — for a hospital director deciding whether the waitlist is
 * worth running — the least informative number the screen could show.
 */
export function planRecovery(input: RecoveryInput): OfferPlan[] {
  const plans: OfferPlan[] = [];
  let nextAcceptor = 0;

  for (const chair of input.freed) {
    if (!input.rng.chance(0.6)) continue;

    const offeredAt = time.addMinutes(chair.markedAt, input.rng.int(1, 4));
    const expiresAt = time.addMinutes(offeredAt, OFFER_WINDOW_MINUTES);

    // Somebody seen *after* the offer went out. A patient already in the
    // chamber cannot have accepted a chair that freed while they were in it,
    // and the log would say two contradictory things about one minute.
    const acceptor = input.seen.slice(nextAcceptor).find((seen) => seen.calledAt > expiresAt);

    if (acceptor === undefined || !input.rng.chance(0.75)) {
      // Offered and unanswered. `FR-QUE-30` passes it to the next patient;
      // in this history nobody else was on the list, so it simply lapsed.
      const standby = input.seen[nextAcceptor];
      if (standby === undefined) continue;
      nextAcceptor += 1;

      plans.push({
        offerId: randomUuidV7(input.rng),
        freedBookingId: chair.bookingId,
        standbyPatientId: standby.patientId,
        offeredAt,
        expiresAt,
        acceptedBookingId: null,
        acceptedAt: null,
        recoveredPoisha: null,
      });
      continue;
    }

    nextAcceptor = input.seen.indexOf(acceptor) + 1;

    plans.push({
      offerId: randomUuidV7(input.rng),
      freedBookingId: chair.bookingId,
      standbyPatientId: acceptor.patientId,
      offeredAt,
      expiresAt,
      acceptedBookingId: acceptor.bookingId,
      acceptedAt: time.addMinutes(offeredAt, input.rng.int(1, OFFER_WINDOW_MINUTES - 1)),
      // The fee the chair was worth, copied at the moment of acceptance
      // exactly as `recoveredValueFor` does at runtime.
      recoveredPoisha: input.feePoisha,
    });
  }

  return plans;
}

/** The log entries an offer chain produces, for `buildSessionLog` to fold in. */
export function recoveryEvents(
  plans: readonly OfferPlan[],
  actor: EventDraft['actor'],
): EventDraft[] {
  const drafts: EventDraft[] = [];

  for (const plan of plans) {
    drafts.push({
      type: 'SLOT_OFFERED',
      payload: {
        offerId: id(plan.offerId),
        freedBookingId: id<BookingId>(plan.freedBookingId),
        offeredTo: [id<PatientId>(plan.standbyPatientId)],
        expiresAt: plan.expiresAt,
      },
      serverTs: plan.offeredAt,
      clientTs: plan.offeredAt,
      clientEventId: null,
      actor,
    });

    if (plan.acceptedBookingId !== null && plan.acceptedAt !== null) {
      drafts.push({
        type: 'SLOT_ACCEPTED',
        payload: {
          offerId: id(plan.offerId),
          newBookingId: id<BookingId>(plan.acceptedBookingId),
        },
        serverTs: plan.acceptedAt,
        clientTs: plan.acceptedAt,
        clientEventId: null,
        actor,
      });
      continue;
    }

    drafts.push({
      type: 'SLOT_EXPIRED',
      payload: { offerId: id(plan.offerId) },
      serverTs: plan.expiresAt,
      clientTs: plan.expiresAt,
      clientEventId: null,
      actor,
    });
  }

  return drafts;
}

/**
 * Writes the `standby_list` and `slot_offers` rows the events describe.
 *
 * The offer id is generated by the planner rather than by the database,
 * because the event payload names it and the log is written first. That is the
 * same order `offerFreedSlot` uses at runtime, for the same reason: a log must
 * never contain a fact about a row that does not exist.
 */
export async function writeRecoveryRows(
  client: Client,
  sessionId: string,
  plans: readonly OfferPlan[],
): Promise<{ readonly standby: number; readonly offers: number }> {
  if (plans.length === 0) return { standby: 0, offers: 0 };

  const phones = await phonesFor(
    client,
    plans.map((plan) => plan.standbyPatientId),
  );

  const standbyRows = plans
    .map((plan, index) => {
      const phone = phones.get(plan.standbyPatientId);
      if (phone === null || phone === undefined) return null;
      return [
        sessionId,
        plan.standbyPatientId,
        phone,
        index + 1,
        plan.acceptedAt ?? plan.offeredAt,
        // Off the list once they took a chair; still on it if nobody answered.
        plan.acceptedAt,
      ];
    })
    .filter((row): row is (string | number | Timestamp | null)[] => row !== null);

  if (standbyRows.length > 0) {
    await insertRows(
      client,
      'standby_list',
      {
        columns: [
          'session_id',
          'patient_id',
          'contact_phone',
          'position',
          'created_at',
          'removed_at',
        ],
      },
      standbyRows,
      '',
    );
  }

  await insertRows(
    client,
    'slot_offers',
    {
      columns: [
        'id',
        'session_id',
        'freed_booking_id',
        'offered_to_patient_id',
        'offered_at',
        'expires_at',
        'accepted_at',
        'recovered_value_poisha',
        'created_at',
      ],
    },
    plans.map((plan) => [
      plan.offerId,
      sessionId,
      plan.freedBookingId,
      plan.standbyPatientId,
      plan.offeredAt,
      plan.expiresAt,
      plan.acceptedAt,
      plan.recoveredPoisha,
      plan.offeredAt,
    ]),
    '',
  );

  return { standby: standbyRows.length, offers: plans.length };
}

async function phonesFor(
  client: Client,
  patientIds: readonly string[],
): Promise<Map<string, string | null>> {
  const { rows } = await client.query<{ id: string; phone: string | null }>(
    `SELECT id, phone FROM patients WHERE id = ANY($1::uuid[])`,
    [[...new Set(patientIds)]],
  );

  return new Map(rows.map((row) => [row.id, row.phone]));
}

/**
 * A v7-shaped UUID from the seed's own stream.
 *
 * Deterministic, because the whole seed is: `pnpm db:reset` twice must produce
 * the same database, and `crypto.randomUUID` would make the offer ids — which
 * appear inside the event log's payloads — differ between runs.
 */
function randomUuidV7(rng: Rng): string {
  const hex = (length: number): string =>
    Array.from({ length }, () => rng.int(0, 15).toString(16)).join('');

  return [
    hex(8),
    hex(4),
    `7${hex(3)}`,
    `${['8', '9', 'a', 'b'][rng.int(0, 3)] ?? '8'}${hex(3)}`,
    hex(12),
  ].join('-');
}

// ---------------------------------------------------------------------------
// FR-ADM-08 — post-visit feedback
// ---------------------------------------------------------------------------

/**
 * What patients said, in the four dimensions `FR-PAT-83` asks about.
 *
 * Billing is deliberately the weakest score across the demo set. It is the
 * complaint a patient has no other route for — the reason the column exists at
 * all (migration 0007) — and a Feedback tab where every category scores the
 * same is a tab that demonstrates nothing about why four columns beat one.
 */
const COMMENTS_GOOD = [
  'ডাক্তার ভালোভাবে সময় দিয়েছেন।',
  'সিরিয়াল ফোনে দেখা যাওয়ায় অপেক্ষা করতে হয়নি।',
  'পরিষ্কার-পরিচ্ছন্ন পরিবেশ।',
  'রিসেপশনের ব্যবহার ভালো।',
] as const;

const COMMENTS_POOR = [
  'বিল বোঝা যায়নি, আগে যা বলা হয়েছিল তার চেয়ে বেশি নেওয়া হয়েছে।',
  'অনেকক্ষণ বসে থাকতে হয়েছে।',
  'ওয়েটিং রুমে বসার জায়গা কম।',
  'টেস্টের খরচ আগে জানানো হয়নি।',
] as const;

export interface FeedbackInput {
  readonly visitId: string;
  readonly patientId: string;
  readonly hospitalId: string;
  readonly at: Timestamp;
}

/**
 * Writes feedback against a share of the completed visits.
 *
 * Not all of them. A response rate near one is the tell of invented data —
 * real post-visit forms are answered by a minority — and the Feedback tab
 * shows how many people answered beside every average, so the number has to be
 * a plausible one for that line to mean anything.
 */
export async function insertFeedback(
  client: Client,
  rng: Rng,
  visits: readonly FeedbackInput[],
): Promise<number> {
  const rows: (string | number | null | Timestamp)[][] = [];

  for (const visit of visits) {
    if (!rng.chance(0.42)) continue;

    const happy = rng.chance(0.72);
    const score = (): number => (happy ? rng.int(4, 5) : rng.int(1, 3));

    // A patient who answers two of four questions has still said something,
    // and forcing all four is how a feedback form stops being filled in.
    const answered = (): boolean => rng.chance(0.85);

    const billing = happy ? rng.int(3, 5) : rng.int(1, 3);
    const wait = answered() ? score() : null;
    const doctor = answered() ? (happy ? 5 : rng.int(2, 4)) : null;
    const cleanliness = answered() ? score() : null;

    if (wait === null && doctor === null && cleanliness === null) continue;

    rows.push([
      visit.visitId,
      visit.patientId,
      visit.hospitalId,
      wait,
      doctor,
      cleanliness,
      billing,
      rng.chance(0.35) ? rng.pick(happy ? COMMENTS_GOOD : COMMENTS_POOR) : null,
      visit.at,
    ]);
  }

  if (rows.length === 0) return 0;

  await insertRows(
    client,
    'feedback',
    {
      columns: [
        'visit_id',
        'patient_id',
        'hospital_id',
        'wait_score',
        'doctor_score',
        'cleanliness_score',
        'billing_score',
        'comment',
        'created_at',
      ],
    },
    rows,
    '',
  );

  return rows.length;
}
