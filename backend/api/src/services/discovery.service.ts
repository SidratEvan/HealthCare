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

import {
  projectedEnd,
  time,
  type BedKind,
  type PublicCapacity,
  type Timestamp,
} from '@platform/domain';

import { notFound } from '../errors/AppError.js';
import * as bedRepo from '../repositories/bed.repo.js';
import * as discoveryRepo from '../repositories/discovery.repo.js';

import * as queueService from './queue.service.js';

import type { DoctorCard, HospitalCard, SessionCard } from '../repositories/discovery.repo.js';

/** How many days ahead the session picker offers (`S-A-07b`: next 7 days). */
export const BOOKABLE_DAYS = 7;

/**
 * A list and when it was read.
 *
 * `S-A-07`'s cards carry live figures — how many chambers are running right
 * now, how many serials are still open today — and `FR-PAT-14` requires a live
 * figure to say how old it is. The read time belongs to the read, so it is
 * stamped here rather than guessed from when a browser happened to render.
 */
export interface Stamped<T> {
  readonly items: readonly T[];
  readonly asOf: Timestamp;
}

/**
 * A hospital card with its published bed figures (`FR-PAT-14`).
 *
 * `beds` comes from `v_public_hospital_capacity` and nowhere else (DATABASE.md
 * §5). It carries its own `asOf` per kind and for the total, because a bed
 * count is confirmed by a ward at one time and a chamber is running at
 * another, and one stamp on the card would be the age of one of them only.
 * Null only if the view has no row, which a live hospital always has.
 */
export type HospitalListing = HospitalCard & { readonly beds: PublicCapacity | null };

export async function searchHospitals(query: {
  readonly specialty?: string | undefined;
  readonly district?: string | undefined;
  readonly q?: string | undefined;
  readonly lat?: number | undefined;
  readonly lng?: number | undefined;
  readonly bedKind?: BedKind | undefined;
  readonly limit?: number | undefined;
}): Promise<Stamped<HospitalListing>> {
  const cards = await discoveryRepo.listHospitals({
    specialty: query.specialty,
    district: query.district,
    q: query.q,
    lat: query.lat,
    lng: query.lng,
    limit: query.limit ?? 50,
  });

  // `CHIP-A11-<type>`: hospitals that have that kind of bed at all. A
  // hospital whose ICU is full stays in the list — "full" is the answer a
  // family needs, and dropping it would read as "there is no ICU there".
  const withKind =
    query.bedKind === undefined ? null : await bedRepo.hospitalsWithKind(query.bedKind);
  const shown = withKind === null ? cards : cards.filter((card) => withKind.has(card.id));

  const capacity = await bedRepo.publicCapacity(shown.map((card) => card.id));

  return {
    items: shown.map((card) => ({ ...card, beds: capacity.get(card.id) ?? null })),
    asOf: time.fromDate(new Date()),
  };
}

export interface HospitalDetail {
  readonly hospital: HospitalCard;
  readonly departments: readonly discoveryRepo.DepartmentRow[];
  /** The published bed figures (`FR-PAT-14`, `TAB-A05H-BED`). */
  readonly beds: PublicCapacity | null;
}

export async function hospitalDetail(hospitalId: string): Promise<HospitalDetail> {
  const hospital = await discoveryRepo.findHospital(hospitalId);
  if (hospital === null) throw notFound('hospital');

  const [departments, capacity] = await Promise.all([
    discoveryRepo.listDepartments(hospitalId),
    bedRepo.publicCapacity([hospitalId]),
  ]);

  return { hospital, departments, beds: capacity.get(hospitalId) ?? null };
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

/**
 * The doctors at one hospital (`S-A-05h`).
 *
 * `S-A-07` lists hospitals offering a specialty and this is what a card there
 * opens onto, so the specialty is carried through: a patient who asked for a
 * cardiologist should not land on a list of every doctor in the building.
 */
export async function doctorsAt(
  hospitalId: string,
  specialty?: string,
): Promise<Stamped<discoveryRepo.HospitalDoctorCard>> {
  const hospital = await discoveryRepo.findHospital(hospitalId);
  if (hospital === null) throw notFound('hospital');

  const items = await discoveryRepo.doctorsAtHospital(hospitalId, specialty);

  // `sittingNow` and `openSerials` are both live, so the list says when it was
  // read (`FR-PAT-14`).
  return { items, asOf: time.fromDate(new Date()) };
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
