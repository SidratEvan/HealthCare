/**
 * Discovery — how a patient finds care (BACKEND.md §7.2, `FR-PAT-10`…`15`).
 *
 * Everything here is public and unauthenticated, which makes it the surface a
 * stranger sees and therefore the one where honesty rules bite hardest:
 *
 *   - a live figure carries when it was last confirmed (`FR-OFF-03`), because
 *     a wait estimate with no age is a claim the product cannot support;
 *   - availability that cannot be computed is reported as unknown rather than
 *     guessed (`FR-PAT-13`, `PRD.md` §3.2). "not sitting today" and "we do not
 *     know" are different answers and a patient deserves the true one.
 */

import { projectedEnd, time, type Timestamp } from '@platform/domain';

import { notFound } from '../errors/AppError.js';
import * as discoveryRepo from '../repositories/discovery.repo.js';

import * as queueService from './queue.service.js';

import type { DoctorCard, HospitalCard, SessionCard } from '../repositories/discovery.repo.js';

/** How many days ahead the session picker offers (`S-A-07b`: next 7 days). */
export const BOOKABLE_DAYS = 7;

export async function searchHospitals(query: {
  readonly district?: string | undefined;
  readonly q?: string | undefined;
  readonly lat?: number | undefined;
  readonly lng?: number | undefined;
  readonly limit?: number | undefined;
}): Promise<readonly HospitalCard[]> {
  return await discoveryRepo.listHospitals({
    district: query.district,
    q: query.q,
    lat: query.lat,
    lng: query.lng,
    limit: query.limit ?? 50,
  });
}

export interface HospitalDetail {
  readonly hospital: HospitalCard;
  readonly departments: readonly discoveryRepo.DepartmentRow[];
  /**
   * Bed figures are absent, not zero.
   *
   * `v_public_hospital_capacity` is migration 0012 and the schema stops at
   * 0006. Reporting zero free beds would be a number a patient could act on
   * and that nothing supports — `FR-OFF-05` forbids exactly that, so the field
   * is null and a client renders nothing rather than a false reassurance.
   */
  readonly beds: null;
}

export async function hospitalDetail(hospitalId: string): Promise<HospitalDetail> {
  const hospital = await discoveryRepo.findHospital(hospitalId);
  if (hospital === null) throw notFound('hospital');

  return {
    hospital,
    departments: await discoveryRepo.listDepartments(hospitalId),
    beds: null,
  };
}

export async function searchDoctors(query: {
  readonly specialty?: string | undefined;
  readonly hospitalId?: string | undefined;
  readonly q?: string | undefined;
  readonly limit?: number | undefined;
}): Promise<readonly DoctorCard[]> {
  return await discoveryRepo.listDoctors({
    specialty: query.specialty,
    hospitalId: query.hospitalId,
    q: query.q,
    limit: query.limit ?? 50,
  });
}

/** A doctor plus the sessions they could be booked into. */
export async function doctorDetail(doctorId: string): Promise<{
  readonly doctor: DoctorCard;
  readonly sessions: readonly SessionCard[];
}> {
  const doctors = await discoveryRepo.listDoctors({ limit: 1000 });
  const doctor = doctors.find((candidate) => candidate.id === doctorId);
  if (doctor === undefined) throw notFound('doctor');

  return {
    doctor,
    sessions: await discoveryRepo.listBookableSessions({
      doctorId,
      fromDate: today(),
      days: BOOKABLE_DAYS,
    }),
  };
}

export async function sessionsFor(input: {
  readonly doctorId?: string | undefined;
  readonly hospitalId?: string | undefined;
}): Promise<readonly SessionCard[]> {
  return await discoveryRepo.listBookableSessions({
    doctorId: input.doctorId,
    hospitalId: input.hospitalId,
    fromDate: today(),
    days: BOOKABLE_DAYS,
  });
}

/** What `S-A-07b` shows on a session card. */
export interface Availability {
  readonly sessionId: string;
  readonly capacity: number | null;
  readonly taken: number;
  /** Null when the session has no capacity limit. */
  readonly remaining: number | null;
  readonly full: boolean;
  /** The serial the next booking would be given. */
  readonly nextSerial: number;
  /**
   * What a patient booking now would wait, in minutes — or null.
   *
   * Null is a real answer and the honest one before a doctor has arrived: the
   * estimate is built from a measured consultation rate (`FR-QUE-12`), and
   * until the chamber is running there is nothing to measure. `FR-PAT-13`
   * calls that state *unknown*, and it is not the same as zero.
   */
  readonly expectedWaitMinutes: number | null;
  /** Drives `<FreshnessLine>` over the figures above (`FR-OFF-03`). */
  readonly asOf: string;
}

export async function availability(sessionId: string): Promise<Availability> {
  const session = await queueService.requireSession(sessionId);
  const state = await queueService.getState(sessionId);
  const now: Timestamp = time.fromDate(new Date());

  const taken = state.entries.filter((entry) => entry.status !== 'cancelled').length;
  const capacity = session.capacity;

  // The serial allocator is the authority; this only previews what it would
  // give, so a patient is not shown a number the transaction then changes.
  const nextSerial = await queueService.nextSerial(sessionId);

  return {
    sessionId,
    capacity,
    taken,
    remaining: capacity === null ? null : Math.max(0, capacity - taken),
    full: capacity !== null && taken >= capacity,
    nextSerial,
    expectedWaitMinutes: waitForNextSerial(state, now),
    asOf: now,
  };
}

/**
 * How long the next patient to book would wait.
 *
 * `projectedEnd` is when the queue as it stands would finish, which is exactly
 * when somebody joining the end of it would be seen. Using the domain's own
 * function rather than multiplying a rate here means the number quoted at
 * booking and the number the live serial screen shows afterwards come from one
 * definition (`FR-QUE-11`) — a patient told "about forty minutes" and then
 * shown something else has been lied to once, by us, twice.
 *
 * It returns null when the estimate would be a guess: the doctor has not
 * arrived, or the session is paused. That null travels all the way to the
 * screen as *unknown* rather than being softened into a default
 * (`FR-PAT-13`, `PRD.md` §3.2).
 */
function waitForNextSerial(
  state: Awaited<ReturnType<typeof queueService.getState>>,
  now: Timestamp,
): number | null {
  const end = projectedEnd(state, now);
  if (end === null) return null;

  const minutes = Math.round((new Date(end).getTime() - new Date(now).getTime()) / 60_000);
  return Math.max(0, minutes);
}

/** Today in Asia/Dhaka — the calendar day staff and patients call "today". */
function today(): string {
  return time.toDhakaDate(time.fromDate(new Date()));
}
