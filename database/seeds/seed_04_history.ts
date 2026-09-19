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
import { chambers, staffByRole, type ChamberRow } from './lib/lookup.js';
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

/** Reasons a booking was cancelled, declared rather than invented per row. */
const CANCELLATION_REASONS = [
  'রোগী ফোনে বাতিল করেছেন',
  'রোগী অন্য দিনে সরিয়েছেন',
  'ডাক্তার চেম্বার বাতিল করেছেন',
] as const;

export const seed04History: SeedModule = {
  name: 'seed_04_history',
  title: 'five hundred completed past visits and their event logs',
  requirements: ['FR-DEM-03', 'FR-QUE-12', 'FR-ADM-03'],
  writes: ['sessions', 'bookings', 'queue_events', 'queue_state', 'visits', 'medicines'],
  // `visits` arrived with migration 0007, so the record half of `FR-DEM-03` is
  // written now. Prescriptions are not deferred but **dropped**: the owner
  // removed e-prescriptions from this version (`FR-DOC-04`), so there is no
  // longer anything to wait for. Reports come with the lab at step 17.
  deferred: ['FR-DEM-03 (reports — build step 17, feat/lab-pharmacy)'],

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
      const log_ = buildSessionLog(history, plan, inserted, outcomes, staffId);
      const appended = await appendEvents(client, id<SessionId>(sessionId), log_);

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
      if (written !== completed) {
        throw new Error(
          `Session ${sessionId}: ${String(completed)} consultations finished but ${String(written)} records were written.`,
        );
      }

      sessions += 1;
      bookings += inserted.length;
      events += appended.length;
      visits += written;
      noShows += extraNoShows;
      cancellations += extraCancellations;
    }

    if (visits !== HISTORY_VISIT_TARGET) {
      throw new Error(
        `Seeded ${String(visits)} completed visits, expected ${String(HISTORY_VISIT_TARGET)}.`,
      );
    }

    log(
      `      ${String(visits)} completed visits, ${String(noShows)} no-shows, ${String(cancellations)} cancellations across ${String(sessions)} past sessions`,
    );
    log(
      `      ${String(visits)} signed visit records, ${String(formulary)} medicines in the formulary`,
    );
    log('      no prescriptions: FR-DOC-04 was dropped from this version; reports land at step 17');

    return {
      sessions,
      bookings,
      queue_events: events,
      queue_state: sessions,
      visits,
      medicines: formulary,
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

      plans.push({
        chamber,
        date,
        plannedStart,
        plannedEnd: time.fromDhakaWallClock(date, hours.end[0], hours.end[1]),
        capacity: Math.max(20, Math.round((180 / chamber.consultMinutes) * 1.4)),
        // A chamber that starts on the minute is not what this product exists
        // to fix; a chamber forty minutes late is.
        minutesLate: rng.int(0, 45),
        declaredDelay: rng.chance(0.2) ? rng.int(15, 30) : 0,
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
function buildSessionLog(
  rng: Rng,
  plan: PastSession,
  bookings: readonly { id: string; serial: number }[],
  outcomes: readonly Outcome[],
  staffId: string | null,
): EventDraft[] {
  const actor: EventDraft['actor'] =
    staffId === null
      ? { kind: 'system', job: 'seed_04_history' }
      : { kind: 'staff', staffUserId: id<StaffUserId>(staffId), role: 'receptionist' };

  const drafts: EventDraft[] = [];
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

  // `queue_events.seq` orders the log, and the seed inserts in array order —
  // but a cancellation is timestamped before the session opened, so sorting by
  // `serverTs` here keeps the two orderings from disagreeing.
  return drafts.sort((a, b) => (a.serverTs < b.serverTs ? -1 : a.serverTs > b.serverTs ? 1 : 0));
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
): Promise<number> {
  const rows: unknown[][] = [];

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
  }

  if (rows.length === 0) return 0;

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

  return inserted.length;
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
