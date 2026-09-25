/**
 * `FR-DEM-06` — today's live state: bookings across every upcoming session, and
 * one cardiology session sitting mid-queue, ready for the pitch.
 *
 * ## Why today's bookings live here rather than in `seed_02`
 *
 * A booking needs a patient, and patients are written by `seed_03`, which runs
 * after `seed_02`. Splitting "create the session" from "fill the session"
 * across that boundary is the ordering hazard; keeping every live row in one
 * module is the alternative. DATABASE.md §7 calls this file "puts one session
 * mid-queue for the pitch", and today's queues are the same thing one step
 * less far along.
 *
 * ## Why the demo session is timed from `now`, not from 18:00
 *
 * The pitch is not always given in the evening. If the mid-queue session were
 * anchored to the chamber's 18:00 start, a reset at eleven in the morning
 * would produce a session that had seen five patients seven hours before it
 * opened — and the ETA, which is the thing being demonstrated, would be
 * nonsense.
 *
 * So the log is built **backwards from the current instant**: serial 6 was
 * called four minutes ago, the five before it took the time they took, the
 * doctor arrived twelve minutes after a planned start that is therefore about
 * an hour and a quarter ago. Every timestamp is consistent with every other
 * one, at any hour of any day the demo is reset.
 *
 * ## The state the pitch opens on (`PRD.md` §24)
 *
 *   serials 1–5   seen, with measured consultation lengths behind the rate
 *   serial 6      in the chamber
 *   serial 9      has declared they will be twenty minutes late (`FR-QUE-21`)
 *   serials 7–17  waiting
 *   serial 18     the next serial the pitch's first booking will be given
 *   standby       three patients waiting for a freed slot (`FR-PAT-25`)
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
  type QueueSeed,
  type SessionId,
  type StaffUserId,
  type Timestamp,
  type DhakaDate,
} from '@platform/domain';

import { complaintsFor, DEMO_LIVE } from './data/reference.js';
import {
  bookingSource,
  buildIntake,
  insertBookings,
  loadPatients,
  recountGuestBookings,
  type BookingDraft,
  type InsertedBooking,
} from './lib/bookings.js';
import { demoPhone } from './lib/demo.js';
import { appendEvents, writeProjections, type EventDraft } from './lib/events.js';
import { insertRows, one } from './lib/insert.js';
import { chamberOf, chambers, facilityIds, staffByRole, type ChamberRow } from './lib/lookup.js';
import { dhakaDate, SESSION_DAYS } from './seed_02_doctors_sessions.js';

import type { Rng } from './lib/random.js';
import type { SeedContext, SeedModule, SeedSummary } from './lib/runner.js';
import type { Client } from 'pg';

/**
 * How full each day's sessions are, as a fraction of capacity: one entry per
 * day `seed_02` materialises (`SESSION_DAYS`), today first.
 *
 * Nearer days are fuller, which is both true of real booking behaviour and
 * necessary for the discovery screen to be worth looking at: a demo where
 * every session is equally empty says nothing about availability. The far end
 * of the week still has a few serials taken, because a chamber a week out with
 * nobody booked reads as a doctor nobody sees.
 */
export const FILL_BY_DAY: readonly (readonly [number, number])[] = [
  [0.4, 0.75],
  [0.2, 0.5],
  [0.05, 0.25],
  [0.05, 0.2],
  [0.04, 0.18],
  [0.03, 0.15],
  [0.02, 0.12],
  [0.02, 0.1],
];

/** Patients waiting for a freed slot on the demo session (`FR-PAT-25`). */
const STANDBY_COUNT = 3;

/** How long serial 6 has been in the chamber when the pitch begins. */
const IN_CHAMBER_MINUTES = 4;

/** The gap between one consultation ending and the next being called. */
const TURNOVER_SECONDS = 40;

/** How many of those still waiting are already checked in (`FR-REC-18`). */
const CHECKED_IN_WAITING = 4;

export const seed07DemoLive: SeedModule = {
  name: 'seed_07_demo_live',
  title: "today's bookings, and one session mid-queue for the pitch",
  requirements: ['FR-DEM-06', 'FR-QUE-01', 'FR-PAT-25'],
  writes: [
    'sessions',
    'bookings',
    'queue_events',
    'queue_state',
    'standby_list',
    'guest_identities',
    'payments',
  ],

  async run({ client, now, rng, log }: SeedContext): Promise<SeedSummary> {
    const live = rng.stream('demo-live');
    const seededChambers = await chambers(client);
    const patients = await loadPatients(client);
    const receptionists = await staffByRole(client, 'receptionist');

    const demoChamber = chamberOf(seededChambers, DEMO_LIVE.doctorSlug, DEMO_LIVE.hospitalSlug);
    const demoSessionId = await findOrCreateDemoSession(client, demoChamber, now, receptionists);

    // Patients on the demo session are reserved first, so the pitch's queue is
    // stable no matter what the rest of today happens to draw.
    const shuffled = live.shuffle(patients);
    const demoPatients = shuffled.slice(0, DEMO_LIVE.bookingsBefore);
    const standbyPatients = shuffled.slice(
      DEMO_LIVE.bookingsBefore,
      DEMO_LIVE.bookingsBefore + STANDBY_COUNT,
    );

    if (demoPatients.length < DEMO_LIVE.bookingsBefore) {
      throw new Error('Not enough seeded profiles for the demo session; seed_03 must run first.');
    }

    // --- the rest of today, and the week after it ----------------------------
    const upcoming = await loadUpcomingSessions(client, now);
    let bookings = 0;
    let filledSessions = 0;

    for (const session of upcoming) {
      if (session.id === demoSessionId) continue;

      const range = FILL_BY_DAY[session.dayOffset];
      if (range === undefined) {
        throw new Error(
          `No fill declared for day ${String(session.dayOffset)}: FILL_BY_DAY needs one entry per SESSION_DAYS.`,
        );
      }
      const capacity = session.capacity ?? 25;
      const wanted = Math.max(
        1,
        Math.round(capacity * (range[0] + live.next() * (range[1] - range[0]))),
      );

      const chosen = live.shuffle(patients).slice(0, Math.min(wanted, patients.length));
      const drafts = chosen.map<BookingDraft>((patient, index) => ({
        patient,
        serial: index + 1,
        ...bookingSource(live, patient),
        ...complaint(live, session.departmentCode),
        intake: buildIntake(live),
        cancelledReason: null,
      }));

      const inserted = await insertBookings(
        client,
        session.id,
        session.feePoisha,
        drafts,
        receptionists.get(session.hospitalSlug) ?? null,
        time.addMinutes(now, -live.int(30, 6 * 24 * 60)),
      );

      // A session with no events still gets its cache, derived from an empty
      // log: the counters a console shows are `waiting_count` and nothing else
      // yet, and the reducer is what decides that (`DB-P1`).
      await writeProjections(client, seedFor(session, inserted), [], now);

      bookings += inserted.length;
      filledSessions += 1;
    }

    // --- the pitch session --------------------------------------------------
    const demoDrafts = demoPatients.map<BookingDraft>((patient, index) => ({
      patient,
      serial: index + 1,
      ...bookingSource(live, patient),
      ...complaint(live, DEMO_LIVE.departmentCode),
      intake: buildIntake(live),
      cancelledReason: null,
    }));

    const demoSession = await loadSession(client, demoSessionId);
    const demoBookings = await insertBookings(
      client,
      demoSessionId,
      demoSession.feePoisha,
      demoDrafts,
      receptionists.get(DEMO_LIVE.hospitalSlug) ?? null,
      time.addMinutes(now, -live.int(120, 4 * 24 * 60)),
    );

    const staffId = receptionists.get(DEMO_LIVE.hospitalSlug) ?? null;
    const drafts = buildMidQueueLog(live, demoBookings, now, staffId, demoChamber);
    const appended = await appendEvents(client, id<SessionId>(demoSessionId), drafts);

    // The planned start is set from the log, not the other way round: the
    // doctor arrived twelve minutes late, so the chamber was due to open
    // twelve minutes before that.
    const arrived = drafts.find((draft) => draft.type === 'DOCTOR_ARRIVED');
    if (arrived === undefined) throw new Error('The mid-queue log has no DOCTOR_ARRIVED.');
    const plannedStart = time.addMinutes(arrived.serverTs, -DEMO_ARRIVAL_LATE_MINUTES);

    await client.query(
      `UPDATE sessions
          SET session_date  = $2,
              planned_start = $3,
              planned_end   = $4,
              capacity      = $5
        WHERE id = $1`,
      [
        demoSessionId,
        time.toDhakaDate(plannedStart),
        plannedStart,
        time.addMinutes(plannedStart, 180),
        DEMO_LIVE.capacity,
      ],
    );

    const state = await writeProjections(
      client,
      seedFor(
        {
          id: demoSessionId,
          plannedStart,
          plannedEnd: time.addMinutes(plannedStart, 180),
          capacity: DEMO_LIVE.capacity,
          doctorId: demoChamber.doctorId,
          consultMinutes: demoChamber.consultMinutes,
        },
        demoBookings,
      ),
      appended,
      now,
    );

    // --- standby list -------------------------------------------------------
    //
    // `FR-PAT-25`: who is offered a freed slot, in order. The pitch marks a
    // no-show and the slot goes to position 1, so the list has to exist before
    // the demo starts rather than being typed in during it.
    const standbyRows = standbyPatients.map((patient, index) => [
      demoSessionId,
      patient.id,
      demoPhone('standby', index + 1),
      index + 1,
    ]);

    await insertRows(
      client,
      'standby_list',
      { columns: ['session_id', 'patient_id', 'contact_phone', 'position'] },
      standbyRows,
      '',
    );

    // `FR-PAT-26`: position 1 joined from the app and paid when joining, so
    // the first chair reception gives away on the pitch goes to them without
    // anybody being asked — "prepaid gets it automatically", demonstrable on
    // the first tap rather than only described. Positions 2 and 3 are
    // reception's own entries, asked by the counter as before.
    const prepaid = await prepayFirstOnStandby(client, demoSessionId);

    // `FR-PAT-25`: a patient can only join a list for a chamber that is full,
    // so today needs one. The next cardiology chamber at the pitch hospital is
    // set to exactly the serials it already holds: the patient app shows it
    // পূর্ণ, with স্ট্যান্ডবাই তালিকায় নাম দিন beneath.
    const full = await fillOneChamber(client, demoChamber, demoSessionId, now);

    await recountGuestBookings(client);

    const serving = state.entries.find((entry) => entry.status === 'in_chamber');
    log(
      `      pitch session: serial ${String(serving?.serial ?? 0)} in chamber, ${String(
        state.entries.filter((entry) => entry.status === 'booked' || entry.status === 'waiting')
          .length,
      )} waiting, next serial ${String(DEMO_LIVE.bookingsBefore + 1)}`,
    );
    log(`      ${String(filledSessions)} other upcoming sessions filled`);
    log(
      `      standby: position 1 prepaid (${prepaid ? 'yes' : 'no'}); ` +
        `a full chamber for the join: ${full === null ? 'none found' : `${String(full)} serials`}`,
    );

    return {
      bookings: bookings + demoBookings.length,
      queue_events: appended.length,
      queue_state: filledSessions + 1,
      standby_list: standbyRows.length,
      guest_identities: prepaid ? 1 : 0,
      payments: prepaid ? 1 : 0,
    };
  },
};

/**
 * Makes the pitch chamber's first standby place a prepaid one (`FR-PAT-26`).
 *
 * A guest identity for the number already on the row, and a paid payment
 * whose subject is the row itself (migration 0023) — the shape a join from
 * the app with bKash leaves behind. Labelled as demonstration data by the
 * phone range it uses (`database/seeds/lib/demo.ts`).
 */
async function prepayFirstOnStandby(client: Client, sessionId: string): Promise<boolean> {
  const row = await client.query<{ id: string; contact_phone: string; fee_poisha: number }>(
    `SELECT sl.id, sl.contact_phone, s.fee_poisha
       FROM standby_list sl JOIN sessions s ON s.id = sl.session_id
      WHERE sl.session_id = $1 AND sl.position = 1 AND sl.removed_at IS NULL`,
    [sessionId],
  );
  const place = row.rows[0];
  if (place === undefined) return false;

  const guest = await client.query<{ id: string }>(
    `INSERT INTO guest_identities (phone, display_name) VALUES ($1, NULL) RETURNING id`,
    [place.contact_phone],
  );
  const guestId = guest.rows[0]?.id;
  if (guestId === undefined) return false;

  await client.query('UPDATE standby_list SET guest_id = $1 WHERE id = $2', [guestId, place.id]);

  await client.query(
    `INSERT INTO payments
       (standby_id, payer_guest_id, amount_poisha, platform_fee_poisha, method, state,
        idempotency_key, paid_at, created_at)
     VALUES ($1, $2, $3, 0, 'bkash', 'paid', $4, now() - interval '40 minutes',
             now() - interval '40 minutes')`,
    [place.id, guestId, place.fee_poisha, `seed-standby-prepay-${place.id}`],
  );

  return true;
}

/**
 * Fills one of today's chambers to its capacity, so the patient app has a
 * full chamber to join the standby list of (`FR-PAT-25`, `BTN-A06D-STANDBY`).
 *
 * The capacity is lowered to the serials already held rather than bookings
 * being invented to reach it: the chamber is full *because* of rows that
 * exist, and nothing on the roster is made up for the purpose.
 */
async function fillOneChamber(
  client: Client,
  pitch: ChamberRow,
  pitchSessionId: string,
  now: Timestamp,
): Promise<number | null> {
  const result = await client.query<{ capacity: number }>(
    `WITH chosen AS (
       SELECT s.id FROM sessions s
        WHERE s.session_date = $1::date
          AND s.status = 'scheduled'
          AND s.hospital_id = $2
          AND s.department_id = $3
          AND s.id <> $4
          AND s.deleted_at IS NULL
        ORDER BY s.planned_start, s.id
        LIMIT 1
     )
     UPDATE sessions
        SET capacity = (SELECT count(*) FROM bookings b
                         WHERE b.session_id = sessions.id AND b.status <> 'cancelled'
                           AND b.deleted_at IS NULL)
      WHERE id IN (SELECT id FROM chosen)
     RETURNING capacity`,
    [dhakaDate(now, 0), pitch.hospitalId, pitch.departmentId, pitchSessionId],
  );
  return result.rows[0]?.capacity ?? null;
}

/** How late the doctor was on the pitch session. Twelve minutes, every time. */
const DEMO_ARRIVAL_LATE_MINUTES = 12;

/** A session row, with the keys the booking fill needs. */
interface UpcomingSession {
  readonly id: string;
  readonly hospitalSlug: string;
  readonly departmentCode: string;
  readonly doctorId: string;
  readonly capacity: number | null;
  readonly feePoisha: number;
  readonly plannedStart: Timestamp;
  readonly plannedEnd: Timestamp;
  readonly consultMinutes: number;
  /** 0 for today, 1 for tomorrow, 2 for the day after. */
  readonly dayOffset: number;
}

/** Every session `seed_02` materialised, today first. */
async function loadUpcomingSessions(client: Client, now: Timestamp): Promise<UpcomingSession[]> {
  const dates: readonly DhakaDate[] = Array.from({ length: SESSION_DAYS }, (_, offset) =>
    dhakaDate(now, offset),
  );

  const { rows } = await client.query<{
    id: string;
    session_date: string;
    hospital_name: string;
    department_code: string;
    doctor_id: string;
    capacity: number | null;
    fee_poisha: number;
    planned_start: Date;
    planned_end: Date;
    consult_minutes: number;
  }>(
    `SELECT s.id,
            s.session_date::text          AS session_date,
            h.name_en                      AS hospital_name,
            dep.code                       AS department_code,
            s.doctor_id,
            s.capacity,
            s.fee_poisha,
            s.planned_start,
            s.planned_end,
            d.default_consult_minutes      AS consult_minutes
       FROM sessions s
       JOIN hospitals   h   ON h.id   = s.hospital_id
       JOIN departments dep ON dep.id = s.department_id
       JOIN doctors     d   ON d.id   = s.doctor_id
      WHERE s.session_date = ANY($1::date[])
        AND s.deleted_at IS NULL
      ORDER BY s.session_date, s.planned_start, s.id`,
    [dates],
  );

  const slugByName = await facilitySlugsByName(client);

  return rows.map((row) => {
    const slug = slugByName.get(row.hospital_name);
    if (slug === undefined) {
      throw new Error(`Session ${row.id} belongs to an undeclared facility.`);
    }
    return {
      id: row.id,
      hospitalSlug: slug,
      departmentCode: row.department_code,
      doctorId: row.doctor_id,
      capacity: row.capacity,
      feePoisha: row.fee_poisha,
      plannedStart: time.fromDate(row.planned_start),
      plannedEnd: time.fromDate(row.planned_end),
      consultMinutes: row.consult_minutes,
      dayOffset: dates.findIndex((date) => date === row.session_date),
    };
  });
}

/** `hospitals.name_en` → the declared slug, for rows read back out of SQL. */
async function facilitySlugsByName(client: Client): Promise<Map<string, string>> {
  const ids = await facilityIds(client);
  const { rows } = await client.query<{ id: string; name_en: string }>(
    'SELECT id, name_en FROM hospitals WHERE deleted_at IS NULL',
  );
  const slugById = new Map([...ids].map(([slug, hospitalId]) => [hospitalId, slug]));

  const byName = new Map<string, string>();
  for (const row of rows) {
    const slug = slugById.get(row.id);
    if (slug !== undefined) byName.set(row.name_en, slug);
  }
  return byName;
}

/**
 * The pitch session, whichever way it has to be obtained.
 *
 * `seed_02` has already created it if the cardiologist's chamber sits on
 * today's weekday. If it does not — a Friday reset, say — one is created here,
 * because `FR-DEM-06` promises a mid-queue session on every reset and a demo
 * that works six days a week is not a demo.
 */
async function findOrCreateDemoSession(
  client: Client,
  chamber: ChamberRow,
  now: Timestamp,
  receptionists: ReadonlyMap<string, string>,
): Promise<string> {
  const today = dhakaDate(now, 0);

  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM sessions
      WHERE hospital_id = $1 AND doctor_id = $2 AND department_id = $3
        AND session_date = $4 AND deleted_at IS NULL
      ORDER BY planned_start
      LIMIT 1`,
    [chamber.hospitalId, chamber.doctorId, chamber.departmentId, today],
  );

  const existing = rows[0];
  if (existing !== undefined) return existing.id;

  const created = await one<{ id: string }>(
    client,
    `INSERT INTO sessions
       (hospital_id, doctor_id, department_id, room, session_date,
        planned_start, planned_end, capacity, fee_poisha, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      chamber.hospitalId,
      chamber.doctorId,
      chamber.departmentId,
      chamber.room,
      today,
      time.addMinutes(now, -90),
      time.addMinutes(now, 90),
      DEMO_LIVE.capacity,
      chamber.feePoisha,
      receptionists.get(chamber.hospitalSlug) ?? null,
    ],
  );

  return created.id;
}

async function loadSession(client: Client, sessionId: string): Promise<{ feePoisha: number }> {
  const row = await one<{ fee_poisha: number }>(
    client,
    'SELECT fee_poisha FROM sessions WHERE id = $1',
    [sessionId],
  );
  return { feePoisha: row.fee_poisha };
}

/**
 * The mid-queue event log, built backwards from `now`.
 *
 * Reading it forwards: the chamber opened, the doctor arrived twelve minutes
 * late, five patients were seen at their measured durations, one patient rang
 * to say they would be twenty minutes late, and serial 6 went in four minutes
 * ago. Reading it the way it is written: fix the present and derive the past,
 * which is the only way every relative claim stays true whatever hour the
 * reset happens at.
 */
function buildMidQueueLog(
  rng: Rng,
  bookings: readonly InsertedBooking[],
  now: Timestamp,
  staffId: string | null,
  chamber: ChamberRow,
): EventDraft[] {
  const actor: EventDraft['actor'] =
    staffId === null
      ? { kind: 'system', job: 'seed_07_demo_live' }
      : { kind: 'staff', staffUserId: id<StaffUserId>(staffId), role: 'receptionist' };

  const done = bookings.slice(0, DEMO_LIVE.doneThrough);
  const inChamber = bookings[DEMO_LIVE.doneThrough];
  if (inChamber === undefined) {
    throw new Error(
      `The pitch session needs at least ${String(DEMO_LIVE.doneThrough + 1)} bookings.`,
    );
  }

  // Measured consultation lengths, around this doctor's configured rate.
  const consults = done.map(() =>
    clampConsultSeconds(Math.round(chamber.consultMinutes * 60 * (0.7 + rng.next() * 0.6))),
  );

  const calledAtSix = time.addMinutes(now, -IN_CHAMBER_MINUTES);

  // Walk back from serial 6's call: each earlier consultation ends one
  // turnover before the next one is called.
  const finishedAt: Timestamp[] = [];
  let cursor = calledAtSix;
  for (let i = consults.length - 1; i >= 0; i -= 1) {
    const endedAt = time.addSeconds(cursor, -TURNOVER_SECONDS);
    finishedAt[i] = endedAt;
    cursor = time.addSeconds(endedAt, -(consults[i] ?? 0));
  }

  const firstCalledAt = cursor;
  const arrivedAt = time.addMinutes(firstCalledAt, -2);
  const plannedStart = time.addMinutes(arrivedAt, -DEMO_ARRIVAL_LATE_MINUTES);
  const openedAt = time.addMinutes(plannedStart, -5);

  const drafts: EventDraft[] = [
    {
      type: 'SESSION_OPENED',
      payload: {},
      serverTs: openedAt,
      clientTs: openedAt,
      clientEventId: null,
      actor,
    },
    {
      type: 'DOCTOR_ARRIVED',
      payload: { arrivedAt, minutesLate: DEMO_ARRIVAL_LATE_MINUTES },
      serverTs: arrivedAt,
      clientTs: arrivedAt,
      clientEventId: null,
      actor,
    },
  ];

  const called: { readonly booking: InsertedBooking; readonly calledAt: Timestamp }[] = [];

  for (const [index, booking] of done.entries()) {
    const endedAt = finishedAt[index];
    const consultSeconds = consults[index];
    if (endedAt === undefined || consultSeconds === undefined) continue;
    const calledAt = time.addSeconds(endedAt, -consultSeconds);
    called.push({ booking, calledAt });

    drafts.push({
      type: 'PATIENT_CALLED',
      payload: { bookingId: id<BookingId>(booking.id), serial: asSerial(booking.serial) },
      serverTs: calledAt,
      clientTs: calledAt,
      clientEventId: null,
      actor,
    });
    drafts.push({
      type: 'PATIENT_DONE',
      payload: { bookingId: id<BookingId>(booking.id), consultSeconds },
      serverTs: endedAt,
      clientTs: endedAt,
      clientEventId: null,
      actor,
    });
  }

  // `FR-QUE-21` / `FR-PAT-33`: the patient declares it themselves, so the
  // actor is the patient — or the guest, acting on their own booking through
  // the tracking link. Reception did not type this in, and the log should not
  // claim it did.
  const lateBooking = bookings[DEMO_LIVE.lateSerial - 1];
  if (lateBooking !== undefined) {
    const declaredAt = time.addMinutes(now, -rng.int(6, 14));
    drafts.push({
      type: 'PATIENT_LATE',
      payload: {
        bookingId: id<BookingId>(lateBooking.id),
        expectedMinutes: 20,
        // `hospital_settings.late_reinsert_after` default (`FR-QUE-21`).
        reinsertAfter: 3,
      },
      serverTs: declaredAt,
      clientTs: declaredAt,
      clientEventId: null,
      actor: lateActor(lateBooking),
    });
  }

  drafts.push({
    type: 'PATIENT_CALLED',
    payload: { bookingId: id<BookingId>(inChamber.id), serial: asSerial(inChamber.serial) },
    serverTs: calledAtSix,
    clientTs: calledAtSix,
    clientEventId: null,
    actor,
  });
  called.push({ booking: inChamber, calledAt: calledAtSix });

  drafts.push(...checkInDrafts(rng.stream('check-ins'), bookings, called, chamber, now, actor));

  return drafts.sort((a, b) => (a.serverTs < b.serverTs ? -1 : a.serverTs > b.serverTs ? 1 : 0));
}

/**
 * Who reception has checked in so far this evening (`FR-REC-18`).
 *
 * Everybody already called was checked in before their turn, so the overview
 * has real waits and real quotes to report for today. Of those still waiting,
 * the next few in line are here — checked in within the last half hour and
 * quoted what the queue estimated — and the rest are not yet, so reception
 * opens with somebody to check in and a guest booking made during the pitch
 * gets its own এসেছেন to tap. The late patient is not here, which is what
 * late means.
 */
function checkInDrafts(
  rng: Rng,
  bookings: readonly InsertedBooking[],
  called: readonly { readonly booking: InsertedBooking; readonly calledAt: Timestamp }[],
  chamber: ChamberRow,
  now: Timestamp,
  actor: EventDraft['actor'],
): EventDraft[] {
  const quote = (minutes: number): number =>
    Math.min(MAX_QUOTED_WAIT_MINUTES, Math.max(5, Math.round(minutes / 5) * 5));

  const drafts: EventDraft[] = called.map(({ booking, calledAt }) => {
    const waited = rng.int(10, 35);
    const at = time.addMinutes(calledAt, -waited);
    return {
      type: 'PATIENT_ARRIVED',
      payload: {
        bookingId: id<BookingId>(booking.id),
        quotedWaitMinutes: quote(waited + rng.int(-8, 10)),
      },
      serverTs: at,
      clientTs: at,
      clientEventId: null,
      actor,
    };
  });

  const waitingNow = bookings
    .slice(DEMO_LIVE.doneThrough + 1)
    .filter((booking) => booking.serial !== DEMO_LIVE.lateSerial)
    .slice(0, CHECKED_IN_WAITING);

  for (const [ahead, booking] of waitingNow.entries()) {
    const at = time.addMinutes(now, -rng.int(3, 25));
    drafts.push({
      type: 'PATIENT_ARRIVED',
      payload: {
        bookingId: id<BookingId>(booking.id),
        quotedWaitMinutes: quote((ahead + 1) * chamber.consultMinutes),
      },
      serverTs: at,
      clientTs: at,
      clientEventId: null,
      actor,
    });
  }

  return drafts;
}

/** Who declared the lateness: the account holder, or the guest themselves. */
function lateActor(booking: InsertedBooking): EventDraft['actor'] {
  const ownerUserId = booking.patient.ownerUserId;
  if (ownerUserId !== null) {
    return { kind: 'patient', userId: id(ownerUserId) };
  }
  return { kind: 'guest', bookingId: id<BookingId>(booking.id) };
}

/** The seed a replay starts from: the session's plan and its immutable roster. */
function seedFor(
  session: {
    readonly id: string;
    readonly plannedStart: Timestamp;
    readonly plannedEnd: Timestamp;
    readonly capacity: number | null;
    readonly doctorId: string;
    readonly consultMinutes: number;
  },
  bookings: readonly InsertedBooking[],
): QueueSeed {
  return {
    plan: {
      sessionId: id<SessionId>(session.id),
      doctorId: id<DoctorId>(session.doctorId),
      plannedStart: session.plannedStart,
      plannedEnd: session.plannedEnd,
      capacity: session.capacity,
      defaultConsultSeconds: session.consultMinutes * 60,
    },
    roster: bookings.map((booking) => ({
      bookingId: id<BookingId>(booking.id),
      serial: asSerial(booking.serial),
      patientId: id<PatientId>(booking.patient.id),
      source: booking.source,
      createdAt: session.plannedStart,
    })),
  };
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
