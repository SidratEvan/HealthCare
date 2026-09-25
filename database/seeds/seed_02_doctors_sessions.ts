/**
 * `FR-DEM-02` — forty doctors, their chambers, their recurring schedules, and
 * the sessions those schedules produce for today and the seven days after it.
 *
 * ## Why eight days and not one
 *
 * DATABASE.md §7 calls this file "40 doctors, templates, today's sessions".
 * Today alone is not enough for a demo that has to work on any day it is run:
 * Friday is the weekend in Bangladesh, so a reset on a Thursday evening would
 * leave the "book for tomorrow" screen empty and the presenter explaining the
 * calendar instead of the product.
 *
 * The session picker offers seven days (`S-A-07b`, `BOOKABLE_DAYS` in
 * `discovery.service`), and in a real deployment the nightly worker keeps it
 * full (BACKEND.md §8, `sessions.materialise` at 02:00). That worker is not
 * built, so after a reset nothing adds a day. Seven days fills the picker on
 * the day of the reset; the eighth keeps it full the day after, so a demo left
 * with people to explore for a week survives one missed daily reset.
 *
 * ## Why a doctor never sits in two chambers at once
 *
 * Eight of the forty hold a second chamber, which is an ordinary consultant
 * pattern. If both chambers ran every evening the seed would claim one person
 * was in Dhanmondi and Mirpur simultaneously — the kind of detail a hospital
 * director notices in the first minute. So a second chamber takes the two
 * weekdays the primary one gives up (see `chamberWeekdays`).
 */

import { time } from '@platform/domain';
import type { DhakaDate, Timestamp } from '@platform/domain';

import { DEMO_DOCTORS } from './data/doctors.js';
import { DEMO_FACILITIES, facility } from './data/hospitals.js';
import { DEMO_LIVE } from './data/reference.js';
import { demoBmdc, labelBn, labelEn, taka } from './lib/demo.js';
import { insertRows } from './lib/insert.js';
import { chambers, facilityIds, departmentIds, doctorIds, staffByRole } from './lib/lookup.js';

import type { SeedContext, SeedModule, SeedSummary } from './lib/runner.js';

/** ISO-8601 weekday, matching `session_templates.weekday`. 5 is Friday. */
const FRIDAY = 5;

/** Weekdays a doctor with one chamber sits: everything but Friday. */
const WEEKDAYS_SINGLE = [6, 7, 1, 2, 3, 4] as const;

/** A two-chamber doctor: the primary keeps Saturday to Tuesday… */
const WEEKDAYS_PRIMARY = [6, 7, 1, 2] as const;

/** …and the second chamber takes Wednesday and Thursday. */
const WEEKDAYS_SECONDARY = [3, 4] as const;

/**
 * Doctors who also hold a Friday chamber, at their primary facility.
 *
 * Every one is at the government college or the clinic, which is where a
 * weekend outpatient session actually happens. They also keep the demo from
 * being empty when it is reset on a Thursday for a Friday pitch.
 */
const FRIDAY_CHAMBERS: readonly string[] = [
  'nusrat-jahan',
  'rafiqul-islam',
  'tahmina-begum',
  'sabbir-ahmed',
  'anwara-khatun',
  'jahangir-alam',
];

/** Chamber hours per facility, in Asia/Dhaka wall clock (`FR-DEM-02`). */
const CHAMBER_HOURS: Readonly<Record<string, { start: [number, number]; end: [number, number] }>> =
  {
    'shapla-general': { start: [18, 0], end: [21, 0] },
    'padma-specialised': { start: [18, 0], end: [21, 0] },
    'karnaphuli-general': { start: [17, 30], end: [20, 30] },
    'jamuna-medical-college': { start: [17, 0], end: [20, 0] },
    'meghna-diagnostic': { start: [18, 30], end: [21, 30] },
    'buriganga-clinic': { start: [17, 30], end: [20, 30] },
  };

/** The largest serial a facility of each size will issue for one chamber. */
const CAPACITY_CEILING: Readonly<Record<string, number>> = { large: 45, mid: 35, small: 25 };

/**
 * How many days of sessions a reset produces, starting today: the picker's
 * seven (`S-A-07b`) and one more (see the header).
 */
export const SESSION_DAYS = 8;

export const seed02DoctorsSessions: SeedModule = {
  name: 'seed_02_doctors_sessions',
  title: 'forty doctors, chambers, recurring schedules, eight days of sessions',
  requirements: ['FR-DEM-02', 'FR-DEM-07', 'FR-QUE-01'],
  writes: ['doctors', 'doctor_hospitals', 'session_templates', 'sessions'],

  async run({ client, now, rng, log }: SeedContext): Promise<SeedSummary> {
    const verification = rng.stream('bmdc-verification');
    const facilities = await facilityIds(client);
    const departments = await departmentIds(client);
    const admins = await staffByRole(client, 'hospital_admin');

    // --- doctors -----------------------------------------------------------
    //
    // Every demo doctor is verified: an unverified doctor cannot be published
    // (`FR-SUP-02`), and an unpublished doctor is an empty discovery screen.
    // `user_id` stays null — that column is the doctor's own login, and no
    // authentication is built in this version (CLAUDE.md §4.1).
    const doctorRows = DEMO_DOCTORS.map((entry, index) => [
      labelBn(entry.nameBn),
      labelEn(entry.nameEn),
      demoBmdc(index + 1),
      minutesAgo(now, verification.int(90, 400) * 24 * 60),
      entry.degrees,
      entry.specialties,
      entry.consultMinutes,
    ]);

    await insertRows(
      client,
      'doctors',
      {
        columns: [
          'full_name_bn',
          'full_name_en',
          'bmdc_number',
          'bmdc_verified_at',
          'degrees',
          'specialties',
          'default_consult_minutes',
        ],
      },
      doctorRows,
      '',
    );

    const doctors = await doctorIds(client);

    // --- doctor_hospitals --------------------------------------------------
    const chamberRows: unknown[][] = [];
    for (const entry of DEMO_DOCTORS) {
      const doctorId = doctors.get(entry.slug);
      if (doctorId === undefined) throw new Error(`No id for doctor ${entry.slug}.`);

      for (const chamber of entry.chambers) {
        const hospitalId = facilities.get(chamber.hospitalSlug);
        const departmentId = departments.get(`${chamber.hospitalSlug}:${chamber.departmentCode}`);
        if (hospitalId === undefined || departmentId === undefined) {
          throw new Error(
            `${entry.slug} is declared at ${chamber.hospitalSlug}/${chamber.departmentCode}, which seed_01 did not create.`,
          );
        }

        chamberRows.push([
          doctorId,
          hospitalId,
          departmentId,
          // DB-P5: taka in the declaration, integer poisha in the column.
          taka(chamber.feeTaka),
          chamber.room,
          admins.get(chamber.hospitalSlug) ?? null,
        ]);
      }
    }

    await insertRows(
      client,
      'doctor_hospitals',
      {
        columns: ['doctor_id', 'hospital_id', 'department_id', 'fee_poisha', 'room', 'created_by'],
      },
      chamberRows,
      '',
    );

    const seededChambers = await chambers(client);

    // --- session_templates -------------------------------------------------
    //
    // `active_from` is three months back so that the past sessions
    // `seed_04_history` writes sit inside a schedule that existed at the time.
    // A history whose sessions predate their own template would be a small lie
    // that the first admin report would surface.
    const activeFrom = dhakaDate(now, -90);
    const templateRows: unknown[][] = [];
    const sessionRows: unknown[][] = [];

    for (const chamber of seededChambers) {
      const hours = CHAMBER_HOURS[chamber.hospitalSlug];
      if (hours === undefined) {
        throw new Error(`No chamber hours declared for ${chamber.hospitalSlug}.`);
      }

      const weekdays = chamberWeekdays(chamber.doctorSlug, chamber.hospitalSlug);
      const capacity = capacityFor(chamber.hospitalSlug, hours, chamber.consultMinutes);

      for (const weekday of weekdays) {
        templateRows.push([
          chamber.id,
          weekday,
          `${pad(hours.start[0])}:${pad(hours.start[1])}`,
          `${pad(hours.end[0])}:${pad(hours.end[1])}`,
          capacity,
          activeFrom,
          admins.get(chamber.hospitalSlug) ?? null,
        ]);
      }

      // --- sessions, materialised from those templates ---------------------
      for (let offset = 0; offset < SESSION_DAYS; offset += 1) {
        const date = dhakaDate(now, offset);
        const plannedStart = time.fromDhakaWallClock(date, hours.start[0], hours.start[1]);
        if (!weekdays.includes(time.dhakaWeekday(plannedStart))) continue;

        sessionRows.push([
          chamber.hospitalId,
          chamber.doctorId,
          chamber.departmentId,
          chamber.room,
          date,
          plannedStart,
          time.fromDhakaWallClock(date, hours.end[0], hours.end[1]),
          // The pitch session is given its declared capacity, not the formula's
          // — `seed_07_demo_live` needs room for seventeen bookings plus
          // whatever the presenter adds (`FR-DEM-06`).
          isDemoLive(chamber.doctorSlug, chamber.hospitalSlug, offset)
            ? DEMO_LIVE.capacity
            : capacity,
          // DB-P5, and copied onto the session so a later fee change cannot
          // rewrite a booking already made.
          chamber.feePoisha,
          admins.get(chamber.hospitalSlug) ?? null,
        ]);
      }
    }

    await insertRows(
      client,
      'session_templates',
      {
        columns: [
          'doctor_hospital_id',
          'weekday',
          'start_time',
          'end_time',
          'capacity',
          'active_from',
          'created_by',
        ],
      },
      templateRows,
      '',
    );

    await insertRows(
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
        ],
      },
      sessionRows,
      '',
    );

    const today = dhakaDate(now, 0);
    const todayCount = sessionRows.filter((row) => row[4] === today).length;
    log(
      `      ${String(todayCount)} sessions today (${today}), ${String(sessionRows.length)} across ${String(SESSION_DAYS)} days`,
    );

    return {
      doctors: doctorRows.length,
      doctor_hospitals: chamberRows.length,
      session_templates: templateRows.length,
      sessions: sessionRows.length,
    };
  },
};

/**
 * Which weekdays a chamber runs.
 *
 * A doctor with one chamber sits every evening but Friday. A doctor with two
 * splits the week, so the seed never claims one person was in two places at
 * the same hour.
 */
export function chamberWeekdays(doctorSlug: string, hospitalSlug: string): readonly number[] {
  const declared = DEMO_DOCTORS.find((entry) => entry.slug === doctorSlug);
  if (declared === undefined) throw new Error(`Unknown doctor slug ${doctorSlug}.`);

  const position = declared.chambers.findIndex((chamber) => chamber.hospitalSlug === hospitalSlug);
  if (position === -1) throw new Error(`${doctorSlug} holds no chamber at ${hospitalSlug}.`);

  const single = declared.chambers.length === 1;
  const base: number[] = single
    ? [...WEEKDAYS_SINGLE]
    : position === 0
      ? [...WEEKDAYS_PRIMARY]
      : [...WEEKDAYS_SECONDARY];

  // A Friday chamber is always the primary one.
  if (position === 0 && FRIDAY_CHAMBERS.includes(doctorSlug)) base.push(FRIDAY);

  return base;
}

/**
 * Serials a chamber offers.
 *
 * Deliberately more than the hours divided by the consultation rate: a
 * Bangladeshi evening chamber overbooks, which is precisely the condition that
 * makes a live queue worth having. The ceiling keeps it from becoming absurd.
 */
function capacityFor(
  hospitalSlug: string,
  hours: { start: [number, number]; end: [number, number] },
  consultMinutes: number,
): number {
  const minutes = hours.end[0] * 60 + hours.end[1] - (hours.start[0] * 60 + hours.start[1]);
  const ceiling = CAPACITY_CEILING[facility(hospitalSlug).size] ?? 25;
  return Math.min(ceiling, Math.round((minutes / consultMinutes) * 1.4));
}

function isDemoLive(doctorSlug: string, hospitalSlug: string, dayOffset: number): boolean {
  return (
    dayOffset === 0 &&
    doctorSlug === DEMO_LIVE.doctorSlug &&
    hospitalSlug === DEMO_LIVE.hospitalSlug
  );
}

/** The Dhaka calendar date `offset` days from the run's anchor instant. */
export function dhakaDate(now: Timestamp, offset: number): DhakaDate {
  return time.toDhakaDate(time.addMinutes(now, offset * 24 * 60));
}

function minutesAgo(now: Timestamp, minutes: number): Timestamp {
  return time.addMinutes(now, -minutes);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Every facility's declared chamber hours, for the modules that book into them. */
export function chamberHours(hospitalSlug: string): {
  start: [number, number];
  end: [number, number];
} {
  const hours = CHAMBER_HOURS[hospitalSlug];
  if (hours === undefined) {
    throw new Error(
      `No chamber hours for ${hospitalSlug}. Declared: ${DEMO_FACILITIES.map((f) => f.slug).join(', ')}.`,
    );
  }
  return hours;
}
