/**
 * `FR-DEM-03` (second half) — five hundred completed past visits, each with the
 * event log that produced it.
 *
 * ## What this module does *not* write, and why
 *
 * `FR-DEM-03` asks for "~500 historical visits with prescriptions and
 * reports". `visits`, `prescriptions`, `prescription_items` and `reports` are
 * created by migration `0007_clinical.sql`, which does not exist — the schema
 * is at 0006 (DATABASE.md §7). So this module writes the half the schema
 * holds today, which is also the half every other part of the product reads:
 *
 *   - a past **session** per evening, ended, with its real event log
 *   - a **booking** per visit, `done`, with the consultation length that was
 *     actually measured (`FR-REC-11`)
 *   - the **projections** that follow: `queue_state`, `sessions.avg_consult_seconds`
 *
 * That last one is the reason this is not deferred wholesale. The rolling
 * consultation rate (`FR-QUE-12`) is what every ETA a patient sees is built
 * from, and a doctor with no history falls back to a configured default
 * (`FR-QUE-10`). Without seeded history the demo's ETAs would all be guesses
 * from the same number, and the pitch's central claim — that the estimate is
 * real — would be hollow.
 *
 * Prescriptions and reports arrive with `0007` in build step 12, which is the
 * branch that also renders them. Tracked in `docs/STATUS.md`.
 *
 * ## No-shows are seeded on purpose
 *
 * Alongside the 500 completed visits are no-shows and cancellations, because
 * the no-show loss figure an administrator is shown (`FR-ADM-03`) and the
 * revenue recovered from a standby acceptance (`FR-QUE-31`) are the numbers
 * that make the product's argument. A demo whose history is perfect has
 * nothing to recover.
 */

import {
  clampConsultSeconds,
  MAX_QUOTED_WAIT_MINUTES,
  id,
  isSpecialtyCode,
  serial as asSerial,
  time,
  type BookingId,
  type DoctorId,
  type PatientId,
  type SessionId,
  type StaffUserId,
  type Timestamp,
} from '@platform/domain';

import { assessmentFor, complaintsFor, DEMO_FORMULARY } from './data/reference.js';
import {
  bookingSource,
  buildIntake,
  insertBookings,
  loadPatients,
  type BookingDraft,
  type InsertedBooking,
  type PatientRow,
} from './lib/bookings.js';
import { appendEvents, writeProjections, type EventDraft } from './lib/events.js';
import { insertRows } from './lib/insert.js';
import { chambers, facilityIds, staffByRole, type ChamberRow } from './lib/lookup.js';
import {
  insertFeedback,
  planRecovery,
  recoveryEvents,
  writeRecoveryRows,
  type FeedbackInput,
} from './lib/recovery.js';
import { chamberHours, chamberWeekdays, dhakaDate } from './seed_02_doctors_sessions.js';

import type { Rng } from './lib/random.js';
import type { SeedContext, SeedModule, SeedSummary } from './lib/runner.js';
import type { Client } from 'pg';

/** Completed consultations across the seeded history — the `FR-DEM-03` figure. */
export const HISTORY_VISIT_TARGET = 500;

/** How far back the history runs. Three weeks of evenings. */
const HISTORY_DAYS = 21;

/** Past evenings seeded per day, across different chambers. */
const SESSIONS_PER_DAY = 2;

/**
 * How many days ago each demo facility went live on the queue (`FR-ADM-02`).
 *
 * Must match `seed_01_hospitals`, which writes `hospitals.onboarded_at`. The
 * trend chart marks this date, and the marker only means something if the
 * chambers on either side of it behave differently — so this constant is read
 * twice: once to stamp the facility, once to decide how late its doctors ran.
 *
 * **This is simulated history, and it is simulated in the honest direction.**
 * The seed decides how late a doctor was, exactly as it decides how many
 * patients attended; what it does not do is touch the measurement. The figure
 * the dashboard draws is computed from these sessions by the same SQL a real
 * hospital's would be, so the shape of the line is a claim about the seed and
 * never about the arithmetic.
 */
const ADOPTION_DAYS_AGO = 12;

/**
 * How late a chamber started, before and after the queue went live.
 *
 * A chamber that starts on the minute is not what this product exists to fix;
 * a chamber forty minutes late is. Afterwards the range narrows rather than
 * collapsing — the queue engine tells people when to come, it does not make
 * consultants punctual, and a demo claiming it did would be the kind of thing
 * a hospital director stops believing the rest of.
 */
const LATE_BEFORE_ADOPTION: readonly [number, number] = [10, 55];
const LATE_AFTER_ADOPTION: readonly [number, number] = [0, 22];

/**
 * Of the patients seen after a facility went live, how many reception checked
 * in (`FR-REC-18`).
 *
 * Not all of them. A walk-up at a busy counter gets called before anybody taps
 * এসেছেন, and a dashboard where every single wait was measured would look
 * like a spreadsheet rather than a hospital. Before the go-live date nobody
 * was checked in, because the button did not exist for them.
 */
const CHECK_IN_SHARE = 0.85;

/**
 * How long a checked-in patient sat before being called, in minutes.
 *
 * After go-live, because people were told when to come: the corridor wait the
 * product exists to shorten, shortened rather than abolished.
 */
const CHECKED_IN_WAIT: readonly [number, number] = [8, 45];

/**
 * How far the counter's quote was from the wait that followed, in minutes.
 *
 * Skewed slightly generous, as a person at a counter is — and wide enough
 * that about a quarter of quotes are broken, which is the figure worth a
 * director's attention.
 */
const QUOTE_ERROR: readonly [number, number] = [-10, 12];

/** Reasons a booking was cancelled, declared rather than invented per row. */
const CANCELLATION_REASONS = [
  'রোগী ফোনে বাতিল করেছেন',
  'রোগী অন্য দিনে সরিয়েছেন',
  'ডাক্তার চেম্বার বাতিল করেছেন',
] as const;

export const seed04History: SeedModule = {
  name: 'seed_04_history',
  title: 'five hundred completed past visits and their event logs',
  requirements: ['FR-DEM-03', 'FR-QUE-12', 'FR-QUE-30', 'FR-ADM-03', 'FR-ADM-08'],
  writes: [
    'sessions',
    'bookings',
    'queue_events',
    'queue_state',
    'visits',
    'medicines',
    'test_orders',
    'reports',
    'standby_list',
    'slot_offers',
    'feedback',
  ],
  // `visits` arrived with migration 0007, so the record half of `FR-DEM-03` is
  // written now. Prescriptions are not deferred but **dropped**: the owner
  // removed e-prescriptions from this version (`FR-DOC-04`), so there is no
  // longer anything to wait for. Reports arrived with the lab at step 17 and
  // are written below, so `FR-DEM-03` is now covered in full.

  async run({ client, now, rng, log }: SeedContext): Promise<SeedSummary> {
    const history = rng.stream('history');
    const seededChambers = await chambers(client);
    const patients = await loadPatients(client);
    const receptionists = await staffByRole(client, 'receptionist');

    // `visits.created_by` is the staff account that signed the record. The
    // roster gives one doctor account per facility, which is the right grain:
    // the visit already names the doctor through `doctor_id`, and this column
    // records who was at the keyboard (`DB-P3`).
    const doctorAccounts = await staffByRole(client, 'doctor');

    const formulary = await insertFormulary(client);

    const plans = choosePastSessions(history, seededChambers, now);
    const perSession = allocateVisits(plans.length, HISTORY_VISIT_TARGET);

    let sessions = 0;
    let bookings = 0;
    let events = 0;
    let visits = 0;
    let noShows = 0;
    let cancellations = 0;
    let feedback = 0;
    let offersMade = 0;
    let offersAccepted = 0;
    let standby = 0;

    for (const [index, plan] of plans.entries()) {
      const completed = perSession[index] ?? 0;
      const extraNoShows = history.int(0, 2);
      const extraCancellations = history.chance(0.35) ? 1 : 0;
      const total = completed + extraNoShows + extraCancellations;

      const sessionId = await insertPastSession(client, plan, receptionists);

      // Distinct profiles: `bookings_one_live_per_patient_per_session` is a
      // unique index, and a session where the same person holds two serials is
      // not a scenario this demo wants to claim.
      const chosen = history.shuffle(patients).slice(0, total);
      if (chosen.length < total) {
        throw new Error(
          `Only ${String(chosen.length)} profiles for ${String(total)} serials; seed_03 must run first.`,
        );
      }

      const outcomes = assignOutcomes(history, chosen, completed, extraNoShows);
      const drafts = outcomes.map<BookingDraft>((outcome, position) => ({
        patient: outcome.patient,
        serial: position + 1,
        ...bookingSource(history, outcome.patient),
        ...complaint(history, plan.chamber.departmentCode),
        intake: buildIntake(history),
        cancelledReason: outcome.kind === 'cancelled' ? history.pick(CANCELLATION_REASONS) : null,
      }));

      const inserted = await insertBookings(
        client,
        sessionId,
        plan.chamber.feePoisha,
        drafts,
        receptionists.get(plan.chamber.hospitalSlug) ?? null,
        // Booked over the preceding days, not at the moment the session ran.
        time.addMinutes(plan.plannedStart, -history.int(60, 5 * 24 * 60)),
      );

      const staffId = receptionists.get(plan.chamber.hospitalSlug) ?? null;
      // Its own stream, so adding check-ins moved none of the draws the rest of
      // the history — the offers, the recoveries, the counts in STATUS — was
      // built from.
      const checkIns = history.stream(`check-ins-${String(index)}`);
      const built = buildSessionLog(history, plan, inserted, outcomes, staffId, checkIns);

      // `FR-QUE-30` against a chair that a no-show left empty. Planned from
      // the log that has just been built, because who could have accepted
      // depends on who was still waiting when the offer went out.
      const offers = planRecovery({
        rng: history,
        feePoisha: plan.chamber.feePoisha,
        freed: built.freed,
        seen: built.seen,
      });

      const appended = await appendEvents(
        client,
        id<SessionId>(sessionId),
        inTimeOrder([...built.drafts, ...recoveryEvents(offers, built.actor)]),
      );

      const recovered = await writeRecoveryRows(client, sessionId, offers);

      await writeProjections(
        client,
        {
          plan: {
            sessionId: id<SessionId>(sessionId),
            doctorId: id<DoctorId>(plan.chamber.doctorId),
            plannedStart: plan.plannedStart,
            plannedEnd: plan.plannedEnd,
            capacity: plan.capacity,
            defaultConsultSeconds: plan.chamber.consultMinutes * 60,
          },
          roster: inserted.map((booking) => ({
            bookingId: id<BookingId>(booking.id),
            serial: asSerial(booking.serial),
            patientId: id<PatientId>(booking.patient.id),
            source: booking.source,
            createdAt: plan.plannedStart,
          })),
        },
        appended,
        now,
      );

      const written = await insertVisits(
        client,
        plan,
        inserted,
        outcomes,
        history,
        doctorAccounts.get(plan.chamber.hospitalSlug) ?? null,
      );

      // The count the log prints is the count the database holds, not the
      // number this module intended to write. `FR-DEM-03` is a promise about
      // rows.
      if (written.length !== completed) {
        throw new Error(
          `Session ${sessionId}: ${String(completed)} consultations finished but ${String(written.length)} records were written.`,
        );
      }

      feedback += await insertFeedback(client, history, written);

      sessions += 1;
      bookings += inserted.length;
      events += appended.length;
      visits += written.length;
      noShows += extraNoShows;
      cancellations += extraCancellations;
      offersMade += recovered.offers;
      offersAccepted += offers.filter((offer) => offer.acceptedBookingId !== null).length;
      standby += recovered.standby;
    }

    if (visits !== HISTORY_VISIT_TARGET) {
      throw new Error(
        `Seeded ${String(visits)} completed visits, expected ${String(HISTORY_VISIT_TARGET)}.`,
      );
    }

    const lab = await insertLabWork(client, now, rng.stream('lab'));

    log(
      `      ${String(visits)} completed visits, ${String(noShows)} no-shows, ${String(cancellations)} cancellations across ${String(sessions)} past sessions`,
    );
    log(
      `      ${String(visits)} signed visit records, ${String(formulary)} medicines in the formulary`,
    );
    log('      no prescriptions: FR-DOC-04 was dropped from this version');
    log(
      `      ${String(offersMade)} freed chairs offered to the standby list, ` +
        `${String(offersAccepted)} taken (FR-QUE-30, FR-ADM-03)`,
    );
    log(`      ${String(feedback)} post-visit responses (FR-ADM-08, seeded only)`);
    log(
      `      ${String(lab.orders)} test orders (${String(lab.open)} still on a bench), ` +
        `${String(lab.reports)} delivered reports`,
    );

    return {
      sessions,
      bookings,
      queue_events: events,
      queue_state: sessions,
      visits,
      medicines: formulary,
      test_orders: lab.orders,
      reports: lab.reports,
      standby_list: standby,
      slot_offers: offersMade,
      feedback,
    };
  },
};

/** One past evening, ready to be written. */
interface PastSession {
  readonly chamber: ChamberRow;
  readonly date: string;
  readonly plannedStart: Timestamp;
  readonly plannedEnd: Timestamp;
  readonly capacity: number;
  /** How late the doctor was, in minutes. Zero is rare and that is realistic. */
  readonly minutesLate: number;
  /** After the facility went live on the queue (`FR-ADM-02`): check-ins exist. */
  readonly live: boolean;
  readonly declaredDelay: number;
  readonly paused: boolean;
}

/**
 * Picks which chambers ran on which past evenings.
 *
 * Only a weekday the chamber actually sits is eligible, so the history agrees
 * with the schedule that produced it (`session_templates.active_from` in
 * `seed_02` reaches back far enough to cover all of this).
 */
function choosePastSessions(rng: Rng, all: readonly ChamberRow[], now: Timestamp): PastSession[] {
  const plans: PastSession[] = [];

  for (let offset = 1; offset <= HISTORY_DAYS; offset += 1) {
    const date = dhakaDate(now, -offset);
    const eligible = all.filter((chamber) => {
      const hours = chamberHours(chamber.hospitalSlug);
      const start = time.fromDhakaWallClock(date, hours.start[0], hours.start[1]);
      return chamberWeekdays(chamber.doctorSlug, chamber.hospitalSlug).includes(
        time.dhakaWeekday(start),
      );
    });
    if (eligible.length === 0) continue;

    for (const chamber of rng.shuffle(eligible).slice(0, SESSIONS_PER_DAY)) {
      const hours = chamberHours(chamber.hospitalSlug);
      const plannedStart = time.fromDhakaWallClock(date, hours.start[0], hours.start[1]);

      const live = offset <= ADOPTION_DAYS_AGO;
      const [earliest, latest] = live ? LATE_AFTER_ADOPTION : LATE_BEFORE_ADOPTION;

      plans.push({
        chamber,
        date,
        plannedStart,
        plannedEnd: time.fromDhakaWallClock(date, hours.end[0], hours.end[1]),
        capacity: Math.max(20, Math.round((180 / chamber.consultMinutes) * 1.4)),
        minutesLate: rng.int(earliest, latest),
        live,
        declaredDelay: rng.chance(live ? 0.12 : 0.28) ? rng.int(15, 30) : 0,
        paused: rng.chance(0.3),
      });
    }
  }

  return plans;
}

/**
 * Splits the visit target across the sessions as evenly as it divides.
 *
 * Exact rather than approximate, so the seed test can assert 500 and a future
 * change to `HISTORY_DAYS` cannot quietly turn `FR-DEM-03` into 487.
 */
function allocateVisits(sessionCount: number, target: number): number[] {
  if (sessionCount === 0) throw new Error('No past sessions to allocate visits across.');
  const base = Math.floor(target / sessionCount);
  const remainder = target % sessionCount;
  return Array.from({ length: sessionCount }, (_, index) => (index < remainder ? base + 1 : base));
}

type Outcome =
  | { readonly kind: 'done'; readonly patient: PatientRow; readonly consultSeconds: number }
  | { readonly kind: 'no_show'; readonly patient: PatientRow }
  | { readonly kind: 'cancelled'; readonly patient: PatientRow };

/**
 * Decides what became of each serial, then shuffles them into the order they
 * were booked — a no-show is not politely last in the queue.
 */
function assignOutcomes(
  rng: Rng,
  patients: readonly PatientRow[],
  completed: number,
  noShows: number,
): Outcome[] {
  const outcomes: Outcome[] = patients.map((patient, index) => {
    if (index < completed) {
      return { kind: 'done', patient, consultSeconds: 0 };
    }
    if (index < completed + noShows) return { kind: 'no_show', patient };
    return { kind: 'cancelled', patient };
  });
  return rng.shuffle(outcomes);
}

/**
 * The event log of one past evening.
 *
 * Written in the order it happened, with a clock that advances by each
 * measured consultation — so the log is internally consistent and the rate the
 * reducer derives from it is a real average of real durations.
 */
interface SessionLog {
  readonly drafts: readonly EventDraft[];
  readonly actor: EventDraft['actor'];
  /** Chairs a no-show left empty, with the instant reception marked them. */
  readonly freed: readonly { readonly bookingId: string; readonly markedAt: Timestamp }[];
  /** Everybody seen, in the order they were called (`FR-QUE-30`'s candidates). */
  readonly seen: readonly {
    readonly bookingId: string;
    readonly patientId: string;
    readonly calledAt: Timestamp;
  }[];
}

function buildSessionLog(
  rng: Rng,
  plan: PastSession,
  bookings: readonly InsertedBooking[],
  outcomes: readonly Outcome[],
  staffId: string | null,
  checkIns: Rng,
): SessionLog {
  const actor: EventDraft['actor'] =
    staffId === null
      ? { kind: 'system', job: 'seed_04_history' }
      : { kind: 'staff', staffUserId: id<StaffUserId>(staffId), role: 'receptionist' };

  const drafts: EventDraft[] = [];
  const freed: { bookingId: string; markedAt: Timestamp }[] = [];
  const seen: { bookingId: string; patientId: string; calledAt: Timestamp }[] = [];
  const openedAt = time.addMinutes(plan.plannedStart, -rng.int(0, 10));
  const arrivedAt = time.addMinutes(plan.plannedStart, plan.minutesLate);

  drafts.push({
    type: 'SESSION_OPENED',
    payload: {},
    serverTs: openedAt,
    clientTs: openedAt,
    clientEventId: null,
    actor,
  });

  drafts.push({
    type: 'DOCTOR_ARRIVED',
    payload: { arrivedAt, minutesLate: plan.minutesLate },
    serverTs: arrivedAt,
    clientTs: arrivedAt,
    clientEventId: null,
    actor,
  });

  if (plan.declaredDelay > 0) {
    const declaredAt = time.addMinutes(arrivedAt, rng.int(1, 10));
    drafts.push({
      type: 'DELAY_DECLARED',
      payload: { minutes: plan.declaredDelay, reason: null, declaredBy: 'reception' },
      serverTs: declaredAt,
      clientTs: declaredAt,
      clientEventId: null,
      actor,
    });
  }

  let cursor = arrivedAt;
  let consultationsSoFar = 0;

  for (const [index, outcome] of outcomes.entries()) {
    const booking = bookings[index];
    if (booking === undefined) continue;
    const bookingId = id<BookingId>(booking.id);

    // A prayer break, once, roughly a third of the way through.
    if (plan.paused && consultationsSoFar === Math.floor(outcomes.length / 3)) {
      const pausedAt = cursor;
      const resumedAt = time.addMinutes(pausedAt, rng.int(8, 15));
      drafts.push({
        type: 'SESSION_PAUSED',
        payload: { reason: 'নামাজের বিরতি' },
        serverTs: pausedAt,
        clientTs: pausedAt,
        clientEventId: null,
        actor,
      });
      drafts.push({
        type: 'SESSION_RESUMED',
        payload: {},
        serverTs: resumedAt,
        clientTs: resumedAt,
        clientEventId: null,
        actor,
      });
      cursor = resumedAt;
      consultationsSoFar += 1;
    }

    switch (outcome.kind) {
      case 'done': {
        const consultSeconds = clampConsultSeconds(
          Math.round(plan.chamber.consultMinutes * 60 * (0.55 + rng.next() * 0.95)),
        );
        const calledAt = time.addSeconds(cursor, rng.int(20, 90));
        const doneAt = time.addSeconds(calledAt, consultSeconds);

        // `FR-REC-18`: checked in at the counter some while before the call,
        // and told roughly how long it would be.
        if (plan.live && checkIns.chance(CHECK_IN_SHARE)) {
          const waited = checkIns.int(CHECKED_IN_WAIT[0], CHECKED_IN_WAIT[1]);
          const checkedInAt = time.addMinutes(calledAt, -waited);
          const said = waited + checkIns.int(QUOTE_ERROR[0], QUOTE_ERROR[1]);
          drafts.push({
            type: 'PATIENT_ARRIVED',
            payload: {
              bookingId,
              // Said in round numbers, as a person at a counter says it.
              quotedWaitMinutes: Math.min(
                MAX_QUOTED_WAIT_MINUTES,
                Math.max(5, Math.round(said / 5) * 5),
              ),
            },
            serverTs: checkedInAt,
            clientTs: checkedInAt,
            clientEventId: null,
            actor,
          });
        }

        drafts.push({
          type: 'PATIENT_CALLED',
          payload: { bookingId, serial: asSerial(booking.serial) },
          serverTs: calledAt,
          clientTs: calledAt,
          clientEventId: null,
          actor,
        });
        drafts.push({
          type: 'PATIENT_DONE',
          payload: { bookingId, consultSeconds },
          serverTs: doneAt,
          clientTs: doneAt,
          clientEventId: null,
          actor,
        });

        seen.push({ bookingId: booking.id, patientId: booking.patient.id, calledAt });
        cursor = doneAt;
        consultationsSoFar += 1;
        break;
      }

      case 'no_show': {
        // `FR-QUE-20`: the grace period is two patients or fifteen minutes,
        // whichever is longer, so a no-show is never marked earlier than that.
        const markedAt = time.addMinutes(cursor, rng.int(15, 24));
        drafts.push({
          type: 'PATIENT_NO_SHOW',
          payload: { bookingId, graceUsedMinutes: time.differenceInMinutes(markedAt, cursor) },
          serverTs: markedAt,
          clientTs: markedAt,
          clientEventId: null,
          actor,
        });
        freed.push({ bookingId: booking.id, markedAt });
        cursor = markedAt;
        break;
      }

      case 'cancelled': {
        // Cancelled before the evening began, which is the common case and the
        // one that leaves a serial free to reissue (`FR-QUE-30`).
        const cancelledAt = time.addMinutes(openedAt, -rng.int(30, 600));
        drafts.push({
          type: 'BOOKING_CANCELLED',
          payload: { bookingId, reason: null },
          serverTs: cancelledAt,
          clientTs: cancelledAt,
          clientEventId: null,
          actor,
        });
        break;
      }
    }
  }

  const endedAt = time.addMinutes(cursor, rng.int(2, 12));
  drafts.push({
    type: 'SESSION_ENDED',
    payload: { reason: null },
    serverTs: endedAt,
    clientTs: endedAt,
    clientEventId: null,
    actor,
  });

  return { drafts, actor, freed, seen };
}

/**
 * Puts a session's events into the order they happened.
 *
 * `queue_events.seq` orders the log and the seed inserts in array order — but
 * a cancellation is timestamped before the session opened and an offer is
 * planned after the rest of the evening is known, so both would otherwise
 * arrive out of sequence.
 */
function inTimeOrder(drafts: readonly EventDraft[]): EventDraft[] {
  return [...drafts].sort((a, b) =>
    a.serverTs < b.serverTs ? -1 : a.serverTs > b.serverTs ? 1 : 0,
  );
}

/** A declared chief complaint for this department (CLAUDE.md §8). */
function complaint(rng: Rng, departmentCode: string): { complaintBn: string; complaintEn: string } {
  // The code arrives as a plain string from a row, so it is narrowed here —
  // the boundary where a database value becomes a domain one. An unknown code
  // means the seed and the catalogue have drifted, which is worth failing on
  // rather than silently seeding a booking with no reason for attending.
  if (!isSpecialtyCode(departmentCode)) {
    throw new Error(`"${departmentCode}" is not a specialty the product offers.`);
  }

  const chosen = rng.pick(complaintsFor(departmentCode));
  return { complaintBn: chosen.bn, complaintEn: chosen.en };
}

/** Writes the `sessions` row for a past evening. */
async function insertPastSession(
  client: Client,
  plan: PastSession,
  receptionists: ReadonlyMap<string, string>,
): Promise<string> {
  const rows = await insertRows<{ id: string }>(
    client,
    'sessions',
    {
      columns: [
        'hospital_id',
        'doctor_id',
        'department_id',
        'room',
        'session_date',
        'planned_start',
        'planned_end',
        'capacity',
        'fee_poisha',
        'created_by',
        'created_at',
      ],
    },
    [
      [
        plan.chamber.hospitalId,
        plan.chamber.doctorId,
        plan.chamber.departmentId,
        plan.chamber.room,
        plan.date,
        plan.plannedStart,
        plan.plannedEnd,
        plan.capacity,
        plan.chamber.feePoisha,
        receptionists.get(plan.chamber.hospitalSlug) ?? null,
        plan.plannedStart,
      ],
    ],
  );

  const row = rows[0];
  if (row === undefined) throw new Error('sessions insert returned no id.');
  return row.id;
}

/**
 * The record each completed consultation left behind (`FR-DEM-03`, 0007).
 *
 * `FR-DEM-03` asks for "~500 historical visits with prescriptions and reports".
 * The visits and their notes land here; prescriptions do not, because the owner
 * dropped e-prescriptions from this version (`FR-DOC-04`), and reports arrive
 * with the lab at step 17. So the history holds what this product can honestly
 * produce today: a diagnosis, advice in Bangla, and sometimes a follow-up date.
 *
 * ## Why the note follows the complaint
 *
 * `assessmentFor` is keyed on the complaint the booking already carries, so a
 * patient who came with knee pain has a knee assessment. Drawing the two
 * independently would be cheaper and would produce records that fall apart the
 * moment a hospital director reads one — which is exactly the screen they will
 * read first.
 *
 * ## Why these are signed
 *
 * `signed_at` is what makes a visit a record rather than a draft
 * (`BTN-B05-SIGN`). A past consultation that was never signed would be a
 * half-finished note sitting in a chamber that closed months ago, and the
 * wallet would correctly refuse to show it — leaving step 13 with an empty
 * screen (CLAUDE.md §5.3).
 */
async function insertVisits(
  client: Client,
  plan: PastSession,
  bookings: readonly InsertedBooking[],
  outcomes: readonly Outcome[],
  rng: Rng,
  doctorStaffId: string | null,
): Promise<FeedbackInput[]> {
  const rows: unknown[][] = [];
  const written: Omit<FeedbackInput, 'visitId'>[] = [];

  for (const [index, outcome] of outcomes.entries()) {
    if (outcome.kind !== 'done') continue;

    const booking = bookings[index];
    if (booking === undefined) {
      throw new Error(`No booking for outcome ${String(index)}; the two lists must stay aligned.`);
    }

    const { diagnosisBn, adviceBn } = assessmentFor(booking.complaintEn);

    // The consultation ended some time inside the session, so the record is
    // dated when it was written rather than when the seed ran.
    const seenAt = time.addMinutes(plan.plannedStart, rng.int(10, 170));

    // About half carry a follow-up. Every patient being told to come back is a
    // clinic with no discharges, and `FR-PAT-80` would then remind all 500.
    const followUpDays = rng.chance(0.5) ? rng.pick([7, 14, 30, 90]) : null;

    rows.push([
      booking.id,
      booking.patient.id,
      plan.chamber.hospitalId,
      plan.chamber.doctorId,
      diagnosisBn,
      adviceBn,
      followUpDays === null ? null : dhakaDateOf(seenAt, followUpDays),
      seenAt,
      seenAt,
      doctorStaffId,
    ]);

    written.push({
      patientId: booking.patient.id,
      hospitalId: plan.chamber.hospitalId,
      // Rated after the visit, not during it (`FR-PAT-83` is post-visit).
      at: time.addMinutes(seenAt, rng.int(30, 48 * 60)),
    });
  }

  if (rows.length === 0) return [];

  const inserted = await insertRows<{ id: string }>(
    client,
    'visits',
    {
      columns: [
        'booking_id',
        'patient_id',
        'hospital_id',
        'doctor_id',
        'diagnosis_text',
        'advice_text_bn',
        'follow_up_date',
        'signed_at',
        'created_at',
        'created_by',
      ],
    },
    rows,
  );

  return inserted.map((visit, index) => {
    const detail = written[index];
    /* c8 ignore next -- one `written` entry is pushed per inserted row */
    if (detail === undefined) throw new Error('visit rows and their details drifted apart.');
    return { visitId: visit.id, ...detail };
  });
}

/** The Dhaka calendar date `days` after an instant, as `YYYY-MM-DD`. */
function dhakaDateOf(at: Timestamp, days: number): string {
  return time.toDhakaDate(time.addMinutes(at, days * 24 * 60));
}

/**
 * The medicine formulary (`FR-DOC-05`, DATABASE.md §7's "formulary sample").
 *
 * `seed_00_reference.sql` says this lands "in the same branch as the
 * e-prescription screen that needs autocomplete over it". That screen was
 * dropped (`FR-DOC-04`), so nothing reads these rows in this version — but the
 * table is real, the sample is small and declared (CLAUDE.md §8), and the
 * alternative is a table that exists with nothing in it for whoever builds
 * prescribing later.
 *
 * It lives in this module rather than in the SQL file because the data lives in
 * `data/reference.ts`, and the precedent is already set there: reference data is
 * written from TypeScript, where the row is written, so the list and the rows
 * cannot drift.
 */
async function insertFormulary(client: Client): Promise<number> {
  const rows = DEMO_FORMULARY.map((medicine) => [
    medicine.generic,
    medicine.brand,
    medicine.manufacturer,
    // Postgres array literal: the driver sends text[] as `{a,b}`.
    `{${medicine.strengths.map((strength) => `"${strength}"`).join(',')}}`,
    medicine.form,
  ]);

  const inserted = await insertRows<{ id: string }>(
    client,
    'medicines',
    { columns: ['generic_name', 'brand_name', 'manufacturer', 'strengths', 'form'] },
    rows,
  );

  return inserted.length;
}

// ---------------------------------------------------------------------------
// The lab (`FR-DEM-03`'s reports, `FR-LAB-01..04`, step 17)
// ---------------------------------------------------------------------------

/**
 * The demo catalogue, as `lab.service` holds it.
 *
 * Duplicated here rather than imported: `database/seeds` may not import from
 * `backend/api` (the layering rule), and a catalogue is demo data in both
 * places. `lab.test.ts` holds the two to the same codes, so they cannot drift
 * into a seeded order the console cannot name.
 */
const DEMO_TESTS: readonly { code: string; nameBn: string; pricePoisha: number }[] = [
  { code: 'CBC', nameBn: 'সম্পূর্ণ রক্ত পরীক্ষা (CBC)', pricePoisha: 45_000 },
  { code: 'BLOOD-SUGAR', nameBn: 'রক্তে শর্করা (FBS)', pricePoisha: 20_000 },
  { code: 'LIPID-PROFILE', nameBn: 'লিপিড প্রোফাইল', pricePoisha: 90_000 },
  { code: 'SERUM-CREATININE', nameBn: 'সিরাম ক্রিয়েটিনিন', pricePoisha: 50_000 },
  { code: 'LFT', nameBn: 'লিভার ফাংশন টেস্ট', pricePoisha: 120_000 },
  { code: 'TSH', nameBn: 'থাইরয়েড (TSH)', pricePoisha: 80_000 },
  { code: 'URINE-RE', nameBn: 'প্রস্রাব পরীক্ষা (R/E)', pricePoisha: 25_000 },
  { code: 'XR-CHEST', nameBn: 'বুকের এক্স-রে', pricePoisha: 60_000 },
  { code: 'ECG', nameBn: 'ইসিজি', pricePoisha: 40_000 },
  { code: 'ECHO', nameBn: 'ইকোকার্ডিওগ্রাম', pricePoisha: 250_000 },
  { code: 'USG-ABDOMEN', nameBn: 'পেটের আলট্রাসনোগ্রাম', pricePoisha: 150_000 },
  { code: 'HBA1C', nameBn: 'HbA1c', pricePoisha: 110_000 },
];

/** How many of the seeded visits ordered a test. */
const VISITS_WITH_TESTS = 0.28;

/**
 * Test orders across the seeded history, and the reports for the finished ones.
 *
 * ## What the shape is for
 *
 * Three groups, because three screens read this table and each needs
 * something different in it:
 *
 *   - **Finished, with a delivered report.** The wallet's Reports tab
 *     (`TAB-A12-REP`) and the turnaround medians (`FR-LAB-04`) both stand on
 *     these. Their sample-to-ready spans are drawn per test type, so the
 *     medians differ and the slowest-first ranking has something to rank: an
 *     ECHO takes most of a day, a CBC an hour or two.
 *   - **Still on a bench, from the last two days.** `S-B-08` opens on these,
 *     spread across `ordered`, `sample_collected` and `processing` so every
 *     state button has a row to act on.
 *   - **A few cancelled**, because a queue where nothing was ever called off
 *     does not look like a lab.
 *
 * ## Reports point at a file that resolves
 *
 * `file_url` is an object key under `reports/demo/`, which the mock store
 * synthesises a labelled placeholder for (`adapters/storage.ts`). A seed runs
 * in its own process and cannot put bytes into the API's, and a report row
 * whose URL 404s would be the demo offering a document it cannot open.
 */
async function insertLabWork(
  client: Client,
  now: Timestamp,
  rng: Rng,
): Promise<{ orders: number; reports: number; open: number }> {
  // `hospitals` has no slug column — a slug is a seed-side name, mapped from
  // `name_en` by `facilityIds`. Reverse it once so a visit can name the
  // facility whose lab staff signed its report.
  const slugOf = new Map([...(await facilityIds(client))].map(([slug, id]) => [id, slug] as const));

  const visits = await loadVisitsForTests(client, slugOf);
  if (visits.length === 0) return { orders: 0, reports: 0, open: 0 };

  const labStaff = await staffByRole(client, 'lab');

  const chosen = rng.shuffle(visits).slice(0, Math.floor(visits.length * VISITS_WITH_TESTS));

  const orderRows: unknown[][] = [];
  /** Where in `chosen` and `orderRows` each reported order sits. */
  const reported: { index: number; visit: VisitForTest; readyAt: Timestamp }[] = [];
  let open = 0;

  for (const visit of chosen) {
    const test = rng.pick(DEMO_TESTS);

    // The doctor ordered it during the consultation.
    const orderedAt = time.addMinutes(visit.signedAt, rng.int(-20, 5));
    const hoursOld = time.differenceInHours(now, orderedAt);

    // Anything older than two days has been finished, one way or the other: a
    // bench does not leave a sample sitting for a week, and a queue claiming
    // otherwise would make the oldest-open figure meaningless.
    if (hoursOld > 48) {
      if (rng.chance(0.07)) {
        orderRows.push(orderRow(visit, test, orderedAt, 'cancelled', null, null, null));
        continue;
      }

      const sampleAt = time.addMinutes(orderedAt, rng.int(10, 90));
      const readyAt = time.addMinutes(sampleAt, turnaroundMinutesFor(test.code, rng));
      const deliveredAt = time.addMinutes(readyAt, rng.int(0, 3));

      reported.push({ index: orderRows.length, visit, readyAt });
      orderRows.push(orderRow(visit, test, orderedAt, 'delivered', sampleAt, readyAt, deliveredAt));
      continue;
    }

    // The last two days: work a bench still has.
    open += 1;
    const state = rng.pick(['ordered', 'sample_collected', 'processing'] as const);
    const sampleAt = state === 'ordered' ? null : time.addMinutes(orderedAt, rng.int(10, 90));
    orderRows.push(orderRow(visit, test, orderedAt, state, sampleAt, null, null));
  }

  if (orderRows.length === 0) return { orders: 0, reports: 0, open: 0 };

  const orders = await insertRows<{ id: string }>(
    client,
    'test_orders',
    {
      columns: [
        'visit_id',
        'patient_id',
        'hospital_id',
        'test_code',
        'test_name',
        'state',
        'price_poisha',
        'ordered_by',
        'sample_at',
        'ready_at',
        'delivered_at',
        'created_at',
      ],
    },
    orderRows,
  );

  const reportRows: unknown[][] = [];
  for (const entry of reported) {
    const orderId = orders[entry.index]?.id;
    if (orderId === undefined) continue;

    reportRows.push([
      orderId,
      // The object key. The URL a patient opens is signed when it is served.
      `reports/demo/${orderId}.pdf`,
      'application/pdf',
      labStaff.get(entry.visit.facilitySlug) ?? null,
      entry.readyAt,
      // `reports_delivery_names_recipients`: a delivery stamp names whom it
      // reached, and every one of these came out of a consultation.
      '{patient,doctor}',
      entry.readyAt,
    ]);
  }

  const reports = await insertRows<{ id: string }>(
    client,
    'reports',
    {
      columns: [
        'test_order_id',
        'file_url',
        'file_type',
        'uploaded_by',
        'delivered_to_wallet_at',
        'delivered_to',
        'created_at',
      ],
    },
    reportRows,
  );

  const walkIns = await insertWalkInLabWork(client, now, rng, slugOf);

  return { orders: orders.length + walkIns, reports: reports.length, open: open + walkIns };
}

/** One `test_orders` row, in the column order `insertLabWork` declares. */
function orderRow(
  visit: VisitForTest,
  test: { code: string; nameBn: string; pricePoisha: number },
  orderedAt: Timestamp,
  state: string,
  sampleAt: Timestamp | null,
  readyAt: Timestamp | null,
  deliveredAt: Timestamp | null,
): unknown[] {
  return [
    visit.id,
    visit.patientId,
    visit.hospitalId,
    test.code,
    test.nameBn,
    state,
    test.pricePoisha,
    visit.createdBy,
    sampleAt,
    readyAt,
    deliveredAt,
    orderedAt,
  ];
}

/**
 * How long a test type takes, in minutes from sample to report.
 *
 * Declared per type rather than drawn from one range, because `FR-LAB-04` is
 * a *per test type* figure and a demo where every type had the same median
 * would make the screen that ranks them pointless. These are plausible
 * turnarounds for a hospital lab, not measurements of one.
 */
function turnaroundMinutesFor(code: string, rng: Rng): number {
  switch (code) {
    case 'ECG':
      return rng.int(10, 30);
    case 'CBC':
    case 'URINE-RE':
    case 'BLOOD-SUGAR':
      return rng.int(45, 150);
    case 'XR-CHEST':
      return rng.int(60, 180);
    case 'LIPID-PROFILE':
    case 'SERUM-CREATININE':
    case 'LFT':
      return rng.int(120, 330);
    case 'HBA1C':
    case 'TSH':
      return rng.int(240, 600);
    case 'USG-ABDOMEN':
      return rng.int(90, 260);
    default:
      // ECHO and anything added later: a specialist slot, most of a day.
      return rng.int(360, 900);
  }
}

/** A seeded visit a test could have been ordered from. */
interface VisitForTest {
  readonly id: string;
  readonly patientId: string;
  readonly hospitalId: string;
  readonly facilitySlug: string;
  readonly createdBy: string | null;
  readonly signedAt: Timestamp;
}

async function loadVisitsForTests(
  client: Client,
  slugOf: ReadonlyMap<string, string>,
): Promise<VisitForTest[]> {
  const { rows } = await client.query<{
    id: string;
    patient_id: string;
    hospital_id: string;
    created_by: string | null;
    signed_at: Date;
  }>(
    `SELECT v.id, v.patient_id, v.hospital_id, v.created_by, v.signed_at
       FROM visits v
      WHERE v.deleted_at IS NULL AND v.signed_at IS NOT NULL
      ORDER BY v.signed_at`,
  );

  return rows.map((row) => ({
    id: row.id,
    patientId: row.patient_id,
    hospitalId: row.hospital_id,
    facilitySlug: slugOf.get(row.hospital_id) ?? '',
    createdBy: row.created_by,
    signedAt: row.signed_at.toISOString() as Timestamp,
  }));
}

/**
 * How many orders every lab opens with, at minimum.
 *
 * `CLAUDE.md` §5.3: no feature ships with an empty screen. Which hospitals
 * happened to hold a consultation in the last two days is luck of the seeded
 * history, and on most resets two or three labs had none — so `S-B-08` opened
 * on nothing at exactly the hospital a demo was being shown at.
 */
const OPEN_ORDERS_PER_LAB = 6;

/**
 * Walk-in lab work, so every bench has a queue (`FR-LAB-01`, `GR-03`).
 *
 * These carry **no visit**: `test_orders.visit_id` is nullable precisely
 * because BACKEND.md §7.6 allows an order from a "patient booking" as well as
 * from a doctor, and somebody walking into a diagnostic centre with a paper
 * chit is the commonest way a test is ordered in Bangladesh. It is also the
 * honest way to date them — an order attached to a three-week-old consultation
 * but timed this morning would be a row contradicting itself.
 *
 * A null visit is not a lesser row. It is the path where a report reaches one
 * recipient rather than two (`FR-LAB-03` names the ordering doctor, and there
 * is not one), which is worth having in the demo database rather than only in
 * a test.
 */
async function insertWalkInLabWork(
  client: Client,
  now: Timestamp,
  rng: Rng,
  slugOf: ReadonlyMap<string, string>,
): Promise<number> {
  const labStaff = await staffByRole(client, 'lab');
  if (labStaff.size === 0) return 0;

  const patients = await loadPatients(client);
  if (patients.length === 0) return 0;

  const idOf = new Map([...slugOf].map(([id, slug]) => [slug, id] as const));
  const pool = rng.shuffle(patients);
  let next = 0;

  const rows: unknown[][] = [];

  for (const [slug, staffUserId] of [...labStaff].sort(([a], [b]) => a.localeCompare(b))) {
    const hospitalId = idOf.get(slug);
    if (hospitalId === undefined) continue;

    for (let index = 0; index < OPEN_ORDERS_PER_LAB; index += 1) {
      const patient = pool[next % pool.length];
      next += 1;
      if (patient === undefined) continue;

      const test = rng.pick(DEMO_TESTS);

      // Spread across the last thirty hours, so the oldest has been waiting
      // since yesterday — which is the figure `oldestOpenSeconds` reports and
      // the reason the queue is sorted oldest-first.
      const orderedAt = time.addMinutes(now, -rng.int(30, 30 * 60));

      // Every open state gets rows, so every state button on `S-B-08` has
      // something to act on the moment it opens.
      const state =
        (['ordered', 'sample_collected', 'processing'] as const)[index % 3] ?? 'ordered';
      const sampleAt = state === 'ordered' ? null : time.addMinutes(orderedAt, rng.int(10, 60));

      rows.push([
        null,
        patient.id,
        hospitalId,
        test.code,
        test.nameBn,
        state,
        test.pricePoisha,
        staffUserId,
        sampleAt,
        null,
        null,
        orderedAt,
      ]);
    }
  }

  if (rows.length === 0) return 0;

  const inserted = await insertRows<{ id: string }>(
    client,
    'test_orders',
    {
      columns: [
        'visit_id',
        'patient_id',
        'hospital_id',
        'test_code',
        'test_name',
        'state',
        'price_poisha',
        'ordered_by',
        'sample_at',
        'ready_at',
        'delivered_at',
        'created_at',
      ],
    },
    rows,
  );

  return inserted.length;
}
