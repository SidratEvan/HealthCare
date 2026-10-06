/**
 * Which chambers a hospital's weekly schedule makes (pilot step 22,
 * DATABASE.md §2.3 `session_templates`, `FR-SUP-01`).
 *
 * A schedule says "Tuesdays, 17:00–21:00, twenty serials" in the only clock a
 * hospital thinks in. This turns a set of schedules into the concrete sessions
 * for a run of Dhaka dates — today and the days after it that patients can
 * book (`MATERIALISE_DAYS`). Pure: the job that writes them
 * (`sessionMaterialise.service`) inserts each one only if that schedule has no
 * live session on that date yet (`sessions_template_date_key`, 0028), so
 * working the same answer out twice writes nothing twice.
 */

import { dhakaWeekday, fromDhakaWallClock, toDhakaDate, addMinutes } from '../util/time.js';

import type { DhakaDate, Timestamp } from '../types/ids.js';

/**
 * Today and the next seven days: the patient app offers seven days ahead
 * (`BOOKABLE_DAYS`), and "today" counts as one of the eight.
 */
export const MATERIALISE_DAYS = 8;

/** A weekly schedule as `session_templates` holds it. */
export interface ScheduleTemplate {
  readonly id: string;
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  readonly weekday: number;
  /** `HH:MM` or `HH:MM:SS`, Dhaka wall clock. */
  readonly startTime: string;
  readonly endTime: string;
  readonly activeFrom: DhakaDate;
  readonly activeTo: DhakaDate | null;
}

export interface PlannedSession {
  readonly templateId: string;
  readonly sessionDate: DhakaDate;
  readonly plannedStart: Timestamp;
  readonly plannedEnd: Timestamp;
}

function clock(value: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (match === null) throw new RangeError(`Not a HH:MM time: ${value}`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** A Dhaka date `days` later. Dhaka keeps no daylight saving, so a day is 24 hours. */
export function addDhakaDays(date: DhakaDate, days: number): DhakaDate {
  return toDhakaDate(addMinutes(fromDhakaWallClock(date, 12, 0), days * 24 * 60));
}

/**
 * The sessions `templates` make on `days` dates starting at `from`, in date
 * order. A template makes a session on a date when the weekday matches and
 * the date is inside its active range (`active_to` inclusive).
 */
export function plannedSessions(
  templates: readonly ScheduleTemplate[],
  from: DhakaDate,
  days: number = MATERIALISE_DAYS,
): PlannedSession[] {
  const planned: PlannedSession[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = addDhakaDays(from, offset);
    const weekday = dhakaWeekday(fromDhakaWallClock(date, 12, 0));
    for (const template of templates) {
      if (template.weekday !== weekday) continue;
      if (date < template.activeFrom) continue;
      if (template.activeTo !== null && date > template.activeTo) continue;
      const start = clock(template.startTime);
      const end = clock(template.endTime);
      planned.push({
        templateId: template.id,
        sessionDate: date,
        plannedStart: fromDhakaWallClock(date, start.hour, start.minute),
        plannedEnd: fromDhakaWallClock(date, end.hour, end.minute),
      });
    }
  }
  return planned;
}
