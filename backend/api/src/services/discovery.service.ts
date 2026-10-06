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
  notSharedOf,
  orderForNeed,
  parseNeed,
  pngSize,
  projectedEnd,
  readBrandTheme,
  readSearch,
  time,
  type BedKind,
  type BrandTheme,
  type PublicCapacity,
  type SearchNeed,
  type Timestamp,
} from '@platform/domain';

import { AppError, notFound } from '../errors/AppError.js';
import * as bedRepo from '../repositories/bed.repo.js';
import * as discoveryRepo from '../repositories/discovery.repo.js';

import * as modules from './modules.service.js';
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

/** The hospital an app is scoped to, as `GET /config` reports it. */
export interface ScopeInfo {
  readonly code: string;
  readonly hospitalId: string;
  readonly nameBn: string;
  readonly nameEn: string;
  /** Its colours, if it has set some and they are readable (`FR-BRD-03`). */
  readonly theme: BrandTheme | null;
  /** What it says of itself, and which logo it has (`FR-BRD-06`). */
  readonly descriptionBn: string | null;
  readonly descriptionEn: string | null;
  readonly logoVersion: string | null;
  /**
   * What the logo is as an image, for the description a phone is given when
   * the portal is installed (`FR-BRD-08`). The size is known for a PNG, read
   * from the file's own header; null for any other type, and for no logo.
   */
  readonly logoImage: {
    readonly type: string;
    readonly width: number;
    readonly height: number;
  } | null;
  /**
   * The modules it does not run (`FR-BRD-11`) and the figures it keeps
   * (`FR-NET-04`), so that its own portal offers nothing that would only
   * ever answer with nothing: no bed search where there is no ward, no
   * medicine search where there is no shelf to ask.
   */
  readonly modulesOff: readonly string[];
  readonly notShared: readonly string[];
}

/**
 * The hospital a scope names, or a 404.
 *
 * A wrong code is refused rather than read as "no scope": an app built for
 * one hospital that silently showed the whole network — its competitors —
 * because of a typing mistake in its configuration is the failure this
 * exists to prevent (`FR-BRD-02`).
 */
export async function scopeInfo(code: string): Promise<ScopeInfo> {
  const row = await discoveryRepo.findScope(code);
  if (row === null) throw notFound('hospital');
  return {
    code: row.code,
    hospitalId: row.id,
    nameBn: row.nameBn,
    nameEn: row.nameEn,
    theme: readBrandTheme(row.brand),
    descriptionBn: row.descriptionBn,
    descriptionEn: row.descriptionEn,
    logoVersion: row.logoVersion,
    logoImage: logoImageOf(row.logoType, row.logoHeadHex),
    modulesOff: row.modulesOff,
    notShared: notSharedOf(row.unpublished, row.modulesOff),
  };
}

function logoImageOf(type: string | null, headHex: string | null): ScopeInfo['logoImage'] {
  if (type !== 'image/png' || headHex === null) return null;
  const size = pngSize(headHex);
  return size === null ? null : { type, ...size };
}

/** A live hospital's logo, or null when it has none (`FR-BRD-06`). */
export async function logo(hospitalId: string): Promise<discoveryRepo.LogoFile | null> {
  return await discoveryRepo.findLogo(hospitalId);
}

async function scopedHospitalId(scope: string | undefined): Promise<string | undefined> {
  return scope === undefined ? undefined : (await scopeInfo(scope)).hospitalId;
}

export async function searchHospitals(query: {
  readonly scope?: string | undefined;
  readonly specialty?: string | undefined;
  readonly district?: string | undefined;
  readonly q?: string | undefined;
  readonly lat?: number | undefined;
  readonly lng?: number | undefined;
  readonly bedKind?: BedKind | undefined;
  readonly limit?: number | undefined;
}): Promise<Stamped<HospitalListing>> {
  const cards = await discoveryRepo.listHospitals({
    hospitalId: await scopedHospitalId(query.scope),
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

/** What `GET /search` answers (`S-A-07s`). */
export interface SearchResult {
  /** The need the answer is for: the one chosen, or the one the text names. */
  readonly need: SearchNeed | null;
  /** The text that names were matched against, as typed. */
  readonly text: string | null;
  readonly hospitals: readonly HospitalListing[];
  readonly doctors: readonly DoctorCard[];
  readonly asOf: Timestamp;
}

/** How many doctors a search lists; the screen is a phone's. */
const SEARCH_DOCTORS = 20;

/**
 * One search across the network (`FR-PAT-16`–`18`).
 *
 * A need answers with the hospitals that can provide it, carrying the same
 * live figures every hospital card carries. Text answers with the hospitals
 * and doctors whose names contain it. Text that *names* a need ("ICU",
 * "বার্ন") answers with both: the places that meet the need first, then any
 * whose name happens to contain the word, so that reading a word as a need
 * never hides a hospital called by it.
 *
 * Nothing here is new data. It is `listHospitals`, `listDoctors` and the
 * published bed figures, asked the way a patient asks.
 */
export async function search(query: {
  readonly scope?: string | undefined;
  readonly q?: string | undefined;
  readonly need?: string | undefined;
  readonly lat?: number | undefined;
  readonly lng?: number | undefined;
  readonly limit?: number | undefined;
}): Promise<SearchResult> {
  const limit = query.limit ?? 30;
  const reading = readSearch(query.q);

  let chosen: SearchNeed | null = null;
  if (query.need !== undefined) {
    chosen = parseNeed(query.need);
    // A need the data does not hold is refused, not answered with nothing:
    // an empty list would read as "no hospital has it" (`FR-PAT-18`).
    if (chosen === null) {
      throw new AppError('VALIDATION_FAILED', { details: { need: 'unknown_need' } });
    }
  }

  const need = chosen ?? reading.need;
  // With a chosen need, text narrows it by name. With a need read *from* the
  // text, the text has already been used; matching it against names as well
  // would ask for an ICU inside a hospital called "ICU".
  const narrowing = chosen === null ? undefined : (reading.text ?? undefined);
  // A scoped app's search is its own hospital's: every read below carries it.
  const hospitalId = await scopedHospitalId(query.scope);
  const position = { lat: query.lat, lng: query.lng, hospitalId };

  const byNeed =
    need === null
      ? []
      : await discoveryRepo.listHospitals({
          specialty: need.kind === 'specialty' ? need.code : undefined,
          capability: need.kind === 'capability' ? need.capability : undefined,
          q: narrowing,
          ...position,
          limit,
        });

  const withKind = need?.kind === 'bed' ? await bedRepo.hospitalsWithKind(need.bedKind) : null;
  const meeting = withKind === null ? byNeed : byNeed.filter((card) => withKind.has(card.id));

  // By name: when there is no need at all, or the need was read from the text.
  const byName =
    chosen === null
      ? await discoveryRepo.listHospitals({ q: reading.text ?? undefined, ...position, limit })
      : [];
  const seen = new Set(meeting.map((card) => card.id));
  const named = need === null ? byName : byName.filter((card) => !seen.has(card.id));

  const cards = [...meeting, ...(need === null || reading.text !== null ? named : [])].slice(
    0,
    limit,
  );
  const capacity = await bedRepo.publicCapacity(cards.map((card) => card.id));
  const listings = cards.map((card) => ({ ...card, beds: capacity.get(card.id) ?? null }));

  // Doctors: by name when something was typed, by specialty when that is the
  // need. Not for a bed or a capability, where a list of doctors answers a
  // question nobody asked.
  const doctorsByName =
    reading.text === null
      ? []
      : await discoveryRepo.listDoctors({ q: reading.text, hospitalId, limit: SEARCH_DOCTORS });
  const doctorsBySpecialty =
    need?.kind === 'specialty'
      ? await discoveryRepo.listDoctors({
          specialty: need.code,
          q: narrowing,
          hospitalId,
          limit: SEARCH_DOCTORS,
        })
      : [];
  const doctorIds = new Set(doctorsByName.map((doctor) => doctor.id));
  const doctors = [
    ...doctorsByName,
    ...doctorsBySpecialty.filter((doctor) => !doctorIds.has(doctor.id)),
  ]
    // A scoped app lists a doctor's chambers at its own hospital only: the
    // same doctor's chamber elsewhere is another hospital's listing.
    .map((doctor) =>
      hospitalId === undefined
        ? doctor
        : {
            ...doctor,
            chambers: doctor.chambers.filter((chamber) => chamber.hospitalId === hospitalId),
          },
    )
    // A doctor with no chamber at a live hospital cannot be booked from here.
    .filter((doctor) => doctor.chambers.length > 0)
    .slice(0, SEARCH_DOCTORS);

  return {
    need,
    text: reading.text,
    hospitals: orderForNeed(listings, need),
    doctors,
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
  readonly scope?: string | undefined;
  readonly specialty?: string | undefined;
  readonly hospitalId?: string | undefined;
  readonly q?: string | undefined;
  readonly limit?: number | undefined;
}): Promise<readonly DoctorCard[]> {
  return await discoveryRepo.listDoctors({
    specialty: query.specialty,
    hospitalId: (await scopedHospitalId(query.scope)) ?? query.hospitalId,
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
  /**
   * Null, with `remaining`, where the hospital does not share its serial
   * figures (`FR-NET-04`). `full` and `nextSerial` are not withheld: they are
   * the booking's own answer, to the person about to make it.
   */
  readonly taken: number | null;
  /** Null when the session has no capacity limit, or the figure is not shared. */
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
  // Not published where the hospital does not run serials (`FR-BRD-11`).
  await modules.requireOn(session.hospitalId, 'queue');
  const state = await queueService.getState(sessionId);
  const now: Timestamp = time.fromDate(new Date());

  const taken = state.entries.filter((entry) => entry.status !== 'cancelled').length;
  const capacity = session.capacity;
  const shared = await discoveryRepo.publishes(session.hospitalId, 'serials');

  // The serial allocator is the authority; this only previews what it would
  // give, so a patient is not shown a number the transaction then changes.
  const nextSerial = await queueService.nextSerial(sessionId);

  return {
    sessionId,
    capacity,
    taken: shared ? taken : null,
    remaining: capacity === null || !shared ? null : Math.max(0, capacity - taken),
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
