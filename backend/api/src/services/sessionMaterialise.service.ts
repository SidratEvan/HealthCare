/**
 * Turns weekly schedules into the chambers patients can book (pilot step 22,
 * BACKEND.md §8 `sessions.materialise`, `FR-SUP-01`).
 *
 * Before this, every chamber was a seeded row, and a hospital set up from the
 * settings screen would have had doctors and schedules and nothing to book.
 * This writes today and the next seven days (`MATERIALISE_DAYS`) from the
 * schedules, at start-up and then every hour (`jobs.service`), and once more
 * straight after a schedule is added so its chambers appear at once.
 *
 * It runs inside the API process. `backend/workers` has no database access
 * yet, and a single server in Bangladesh (`FR-SEC-07`) runs one API; the
 * write is idempotent (`sessions_template_date_key`), so two API instances
 * running it at once write each chamber once.
 */

import { MATERIALISE_DAYS, id, plannedSessions, time, type DhakaDate } from '@platform/domain';

import * as repo from '../repositories/sessionMaterialise.repo.js';

/** How often the loop runs. Hourly, so a missed midnight is caught within the hour. */
export const MATERIALISE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Writes the chambers `from` and the seven days after it that do not exist
 * yet. Returns how many it wrote. `onlyTemplate` limits it to one schedule.
 */
export async function materialise(
  options: { readonly from?: DhakaDate; readonly onlyTemplate?: string } = {},
): Promise<number> {
  const from = options.from ?? time.toDhakaDate(time.fromDate(new Date()));
  const schedules = await repo.activeSchedules(from, options.onlyTemplate ?? null);
  if (schedules.length === 0) return 0;

  const bySchedule = new Map(schedules.map((schedule) => [schedule.id, schedule]));
  const planned = plannedSessions(
    schedules.map((schedule) => ({
      id: schedule.id,
      weekday: schedule.weekday,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      activeFrom: id<DhakaDate>(schedule.activeFrom),
      activeTo: schedule.activeTo === null ? null : id<DhakaDate>(schedule.activeTo),
    })),
    from,
    MATERIALISE_DAYS,
  );

  const rows: repo.SessionToWrite[] = [];
  for (const session of planned) {
    const schedule = bySchedule.get(session.templateId);
    if (schedule === undefined) continue;
    rows.push({
      templateId: schedule.id,
      hospitalId: schedule.hospitalId,
      doctorId: schedule.doctorId,
      departmentId: schedule.departmentId,
      room: schedule.room,
      sessionDate: session.sessionDate,
      plannedStart: session.plannedStart,
      plannedEnd: session.plannedEnd,
      capacity: schedule.capacity,
      feePoisha: schedule.feePoisha,
    });
  }
  return await repo.insertMissing(rows);
}
