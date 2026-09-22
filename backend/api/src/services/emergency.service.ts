/**
 * Emergency: search, inbound alerts, the ER console, capabilities
 * (BACKEND.md §7.5; `FR-PAT-40..47`, `FR-EMG-01..05`).
 *
 * ## Search is read-only and public
 *
 * `search` asks the database for geography (`fn_nearby_hospitals`), the public
 * view for figures, the travel-time adapter for minutes, and
 * `shared/domain/src/emergency` for the order and the freshness. It writes
 * nothing and needs nobody (`GR-08`, `FR-PAT-40`).
 *
 * ## Every case action runs the same steps
 *
 *   1. **Lock** the case row. Two ER consoles tapping one alert serialise.
 *   2. **Decide** with `canActOn` — the function the console ran before it
 *      sent the request. An action whose outcome is already the case
 *      (`alreadyApplied`) is a replay from an offline outbox and is answered
 *      as a success without writing (`FR-OFF-01`, SY-02). Anything else the
 *      guard refuses is `EMERGENCY_TRANSITION_INVALID`.
 *   3. **Write** the case and, where the family left a number, the message
 *      that tells them — both in one transaction, so a rolled-back decline
 *      leaves no text claiming it happened.
 *   4. **After commit**, send the message and broadcast the case into the ER
 *      room — never before, because a console that rang for an alert that then
 *      rolled back would be preparing for nobody.
 *
 * ## Identity
 *
 * The console's list, and every broadcast, carry no phone number and no name
 * (`EmergencyCaseView.hasPhone`). The number is read by `contact`, one case at
 * a time, and each read writes `audit_log` (`DB-P7`). A case gains a patient
 * only when the ward admits it.
 */

import {
  alreadyApplied,
  canActOn,
  freshnessOf,
  isOpen,
  nextTokenLabel,
  rankCandidates,
  relevantBedKind,
  relevantFreeBeds,
  requiredCapability,
  stampsFor,
  time,
  EMERGENCY_SEARCH_RADIUS_METRES,
  type BedKind,
  type CapabilityKind,
  type CapacityFigures,
  type EmergencyAction,
  type EmergencyActionContext,
  type EmergencyCaseView,
  type EmergencyProblem,
  type Freshness,
  type PublicCapacity,
  type Sex,
  type Timestamp,
  type TriageColor,
} from '@platform/domain';

import { travelTime } from '../adapters/traveltime.js';
import { signToken, verifyToken } from '../config/jwt.js';
import { env } from '../env.js';
import { AppError, forbiddenScope, notFound, validationFailed } from '../errors/AppError.js';
import * as emit from '../realtime/emit.js';
import * as bedRepo from '../repositories/bed.repo.js';
import * as clinicalRepo from '../repositories/clinical.repo.js';
import * as emergencyRepo from '../repositories/emergency.repo.js';
import { withTransaction, type Tx } from '../repositories/transaction.js';

import * as notifications from './notification.service.js';

import type { CapabilityRow, CaseRow, CaseStatusRow } from '../repositories/emergency.repo.js';

/** The ER coordinator acting, and the hospital they act for (`FR-ROLE-01`). */
export interface ErActor {
  readonly staffUserId: string;
  readonly hospitalId: string;
}

/** Idempotency for offline replay (`FR-OFF-01`, SY-02). */
export interface Envelope {
  readonly clientEventId: string | null;
  readonly clientTs: string | null;
}

/** The longest an ETA can be (`emergency_cases_eta_sane`). */
const MAX_ETA_MINUTES = 600;

// ---------------------------------------------------------------------------
// Search (`S-A-10b`, `FR-PAT-43..45`, and the refer-out suggestion `FR-EMG-02`)
// ---------------------------------------------------------------------------

/** One result card (`CARD-A10-<hospitalId>`, `FR-PAT-44`). */
export interface EmergencyResult {
  readonly hospitalId: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly addressBn: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly emergencyPhone: string | null;
  /** Straight-line kilometres, one decimal. Null without a position. */
  readonly distanceKm: number | null;
  /** An estimate (`TRAVEL_TIME_MODE`); null when there is no position or no provider. */
  readonly travelMinutes: number | null;
  /** Null when the problem needs no particular capability. */
  readonly hasCapability: boolean | null;
  /** `FR-EMG-04`: open cases, counted — never typed. */
  readonly erLoad: number;
  /** Free beds of `bedKind`, or of every kind when that is null. Null: no such beds here. */
  readonly freeBeds: number | null;
  readonly bedKind: BedKind | null;
  /** Null when the facility has no ICU — which is not a full one. */
  readonly icuTotal: number | null;
  readonly icuFree: number | null;
  /** The age of the oldest figure on the card (`FR-PAT-45`). */
  readonly freshness: Freshness;
  readonly staleAfterMinutes: number;
}

export interface EmergencySearch {
  readonly problem: EmergencyProblem | null;
  readonly requiredCapability: CapabilityKind | null;
  /** Where distances were measured from. `none`: ranked without travel time. */
  readonly origin: 'position' | 'hospital' | 'none';
  readonly radiusKm: number;
  /** `static` means an estimate; `unconfigured` means none. */
  readonly travelTime: string;
  readonly results: readonly EmergencyResult[];
  readonly serverTs: string;
}

export async function search(query: {
  readonly lat?: number | undefined;
  readonly lng?: number | undefined;
  readonly problem?: EmergencyProblem | undefined;
  readonly from?: string | undefined;
}): Promise<EmergencySearch> {
  const problem = query.problem ?? null;
  const capability = requiredCapability(problem);
  const everyEr = await emergencyRepo.erHospitals();

  // Where the distances are measured from: the phone, or — for a refer-out
  // suggestion — the ER that is declining, which is then left out.
  let origin: { readonly lat: number; readonly lng: number } | null = null;
  if (query.from !== undefined) {
    const from = everyEr.find((hospital) => hospital.id === query.from);
    if (from === undefined) throw notFound('hospital');
    if (from.lat !== null && from.lng !== null) origin = { lat: from.lat, lng: from.lng };
  } else if (query.lat !== undefined && query.lng !== undefined) {
    origin = { lat: query.lat, lng: query.lng };
  }

  const candidates = everyEr.filter((hospital) => hospital.id !== query.from);

  const geography =
    origin === null
      ? null
      : await emergencyRepo.nearby({
          ...origin,
          capability,
          radiusMetres: EMERGENCY_SEARCH_RADIUS_METRES,
        });

  const inRange =
    geography === null ? candidates : candidates.filter((hospital) => geography.has(hospital.id));
  const ids = inRange.map((hospital) => hospital.id);

  const [capacity, figures, thresholds, capable] = await Promise.all([
    bedRepo.publicCapacity(ids),
    emergencyRepo.emergencyFigures(ids),
    emergencyRepo.staleThresholds(ids),
    geography === null && capability !== null
      ? emergencyRepo.capableNow(ids, capability)
      : Promise.resolve(null),
  ]);

  const at = now();
  const results = inRange.map((hospital): EmergencyResult => {
    const beds = capacity.get(hospital.id) ?? null;
    const er = figures.get(hospital.id);
    const cardFigures = figuresFor(beds, er?.capabilityAsOf ?? null);
    const threshold = thresholds.get(hospital.id) ?? env.STALE_THRESHOLD_MINUTES;
    const place = geography?.get(hospital.id) ?? null;

    const hasCapability =
      capability === null
        ? null
        : place !== null
          ? place.hasCapability
          : (capable?.has(hospital.id) ?? false);

    return {
      hospitalId: hospital.id,
      nameBn: hospital.nameBn,
      nameEn: hospital.nameEn,
      addressBn: hospital.addressBn,
      lat: hospital.lat,
      lng: hospital.lng,
      emergencyPhone: hospital.emergencyPhone,
      distanceKm: place === null ? null : Math.round(place.distanceMetres / 100) / 10,
      travelMinutes: place === null ? null : travelTime().minutesFor(place.distanceMetres, at),
      hasCapability,
      erLoad: er?.erActive ?? 0,
      freeBeds: relevantFreeBeds(problem, cardFigures),
      bedKind: relevantBedKind(problem),
      icuTotal: beds?.icuTotal ?? null,
      icuFree: beds?.icuFree ?? null,
      freshness: freshnessOf(stampsFor(problem, cardFigures), at, threshold),
      staleAfterMinutes: threshold,
    };
  });

  const ranked = rankCandidates(
    results.map((result) => ({
      ...result,
      stale: result.freshness.stale,
    })),
  ).map(({ stale: _stale, ...result }) => result);

  return {
    problem,
    requiredCapability: capability,
    origin: query.from !== undefined ? 'hospital' : origin === null ? 'none' : 'position',
    radiusKm: EMERGENCY_SEARCH_RADIUS_METRES / 1000,
    travelTime: travelTime().name,
    results: ranked,
    serverTs: at,
  };
}

/** The public figures a card is built from, with "no beds here" as zeros and nulls. */
function figuresFor(
  beds: PublicCapacity | null,
  capabilityAsOf: Timestamp | null,
): CapacityFigures {
  return {
    bedTotal: beds?.bedTotal ?? 0,
    bedFree: beds?.bedFree ?? 0,
    icuTotal: beds?.icuTotal ?? null,
    icuAsOf: beds?.icuAsOf ?? null,
    bedsAsOf: beds?.bedsAsOf ?? null,
    capabilityAsOf,
    byKind: beds?.byKind ?? [],
  };
}

// ---------------------------------------------------------------------------
// "I'm on my way" (`BTN-A10-ONWAY`, `FR-PAT-46`, `FR-EMG-01`)
// ---------------------------------------------------------------------------

/** The family's view of their alert (`S-A-10c`). The facility, and nothing about anyone. */
export interface CaseStatusView extends CaseStatusRow {
  readonly serverTs: string;
}

export interface InboundResult {
  readonly case: CaseStatusView;
  /** The family's status link. Returned here and in the SMS, stored nowhere. */
  readonly token: string;
  readonly trackUrl: string;
  /** True when this key already sent an alert, which is returned instead. */
  readonly duplicate: boolean;
}

export async function inbound(input: {
  readonly hospitalId: string;
  readonly problem: EmergencyProblem;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly phone: string | null;
  readonly ageYears: number | null;
  readonly sex: Sex | null;
  readonly idempotencyKey: string | null;
}): Promise<InboundResult> {
  // Only a facility with somebody to ring. A family told "the hospital has
  // been notified" by a facility with no ER console has been told a lie.
  if (!(await emergencyRepo.hasEmergencyDesk(input.hospitalId))) {
    throw validationFailed({ field: 'hospitalId', reason: 'no_emergency_department' });
  }

  // The ETA the ER prepares for. The position is used here and discarded.
  let etaMinutes: number | null = null;
  if (input.lat !== null && input.lng !== null) {
    const distance = await emergencyRepo.distanceTo(input.hospitalId, {
      lat: input.lat,
      lng: input.lng,
    });
    const minutes = distance === null ? null : travelTime().minutesFor(distance, now());
    etaMinutes = minutes === null ? null : Math.min(minutes, MAX_ETA_MINUTES);
  }

  const filed = await withTransaction(async (trx) => {
    if (input.idempotencyKey !== null) {
      await emergencyRepo.lockIdempotencyKey(trx, input.idempotencyKey);
      const existing = await emergencyRepo.findByIdempotencyKey(trx, input.idempotencyKey);
      if (existing !== null) {
        if (existing.hospitalId !== input.hospitalId) {
          throw validationFailed({ field: 'Idempotency-Key', reason: 'reused_for_another_case' });
        }
        return { id: existing.id, duplicate: true };
      }
    }

    const id = await emergencyRepo.insertInbound(trx, {
      hospitalId: input.hospitalId,
      problem: input.problem,
      etaMinutes,
      phone: input.phone,
      ageYears: input.ageYears,
      sex: input.sex,
      idempotencyKey: input.idempotencyKey,
    });
    return { id, duplicate: false };
  });

  if (!filed.duplicate) {
    const created = await requiredCase(filed.id);
    emit.emergencyInbound(input.hospitalId, { case: toView(created) }, now());
  }

  const token = await caseToken(filed.id);
  return {
    case: await statusView(filed.id),
    token,
    trackUrl: trackUrlFor(token),
    duplicate: filed.duplicate,
  };
}

/** `GET /emergency/track/:token` — the family's status screen. */
export async function track(token: string): Promise<CaseStatusView> {
  return await statusView(await caseIdFrom(token));
}

/** `POST /emergency/track/:token/cancel` — `BTN-A10C-CANCEL`: "not coming". */
export async function cancelByFamily(token: string): Promise<CaseStatusView> {
  const caseId = await caseIdFrom(token);
  await act(caseId, 'cancel', {}, null, async (trx) => {
    await emergencyRepo.writeCase(trx, caseId, { state: 'cancelled', closed: true });
    return notifications.NOTHING;
  });
  return await statusView(caseId);
}

// ---------------------------------------------------------------------------
// The ER console (`S-B-07`)
// ---------------------------------------------------------------------------

/** Everything `S-B-07` draws. Names nobody. */
export interface ErBoard {
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly hospitalNameEn: string;
  /** Alerts and the triage list together; the console splits them by state. */
  readonly cases: readonly EmergencyCaseView[];
  /** `FR-EMG-04`. */
  readonly load: number;
  readonly capabilities: readonly CapabilityRow[];
  /** "ICU/bed counters — read from the bed board, not typed twice." */
  readonly published: PublicCapacity | null;
  /** The kinds of bed `BTN-B07-ADMIT` can ask the ward for. */
  readonly bedKinds: readonly BedKind[];
  readonly staleAfterMinutes: number;
  readonly serverTs: string;
}

export async function board(hospitalId: string): Promise<ErBoard> {
  const names = await bedRepo.hospitalNames(hospitalId);
  if (names === null) throw notFound('hospital');

  const [cases, capabilities, published, bedKinds, staleAfterMinutes] = await Promise.all([
    emergencyRepo.openCases(hospitalId),
    emergencyRepo.capabilitiesOf(hospitalId),
    bedRepo.publicCapacity([hospitalId]),
    emergencyRepo.bedKindsAt(hospitalId),
    bedRepo.staleThresholdMinutes(hospitalId),
  ]);

  return {
    hospitalId,
    hospitalNameBn: names.nameBn,
    hospitalNameEn: names.nameEn,
    cases: cases.map(toView),
    load: cases.filter((entry) => isOpen(entry.state)).length,
    capabilities,
    published: published.get(hospitalId) ?? null,
    bedKinds,
    staleAfterMinutes,
    serverTs: now(),
  };
}

/** `GET /emergency/cases/:id/contact` — the number, to call. **Identifying**: audited. */
export async function contact(
  caseId: string,
  actor: ErActor,
): Promise<{ readonly phone: string | null; readonly serverTs: string }> {
  const current = await requiredCase(caseId);
  assertScope(current, actor);

  const phone = await emergencyRepo.contactOf(caseId);
  if (phone !== null) {
    await clinicalRepo.recordRecordView({
      staffUserId: actor.staffUserId,
      userId: null,
      hospitalId: actor.hospitalId,
      patientId: current.patientId,
      subjectTable: 'emergency_cases',
      subjectId: caseId,
      meta: { surface: 'S-B-07', field: 'contact_phone' },
    });
  }

  return { phone, serverTs: now() };
}

/** What every console action returns, and what the console reconciles against. */
export interface CaseActionResult {
  readonly case: EmergencyCaseView;
  readonly load: number;
  /** True when this was a replay of something already applied. */
  readonly duplicate: boolean;
  readonly serverTs: string;
}

/** `POST /emergency/cases/:id/acknowledge` — `BTN-B07-PREPARE`. */
export async function acknowledge(
  caseId: string,
  _envelope: Envelope,
  actor: ErActor,
): Promise<CaseActionResult> {
  return await act(caseId, 'acknowledge', {}, actor, async (trx) => {
    await emergencyRepo.writeCase(trx, caseId, { state: 'acknowledged', acknowledged: true });
    return await notifications.queueEmergencyAnswer(trx, {
      caseId,
      outcome: 'acknowledged',
      link: trackUrlFor(await caseToken(caseId)),
    });
  });
}

export type CaseCommand =
  | { readonly action: 'accept' }
  | { readonly action: 'decline'; readonly reason: string }
  | { readonly action: 'triage'; readonly triage: TriageColor }
  | { readonly action: 'handoff'; readonly bedKind: BedKind }
  | { readonly action: 'discharge' };

/** `PATCH /emergency/cases/:id` — "triage, state" (BACKEND.md §7.5). */
export async function command(
  caseId: string,
  body: CaseCommand,
  _envelope: Envelope,
  actor: ErActor,
): Promise<CaseActionResult> {
  switch (body.action) {
    case 'accept':
      // `BTN-B07-ACCEPT`: the person is here. A token is given at the door.
      return await act(caseId, 'accept', {}, actor, async (trx, current) => {
        const tokens = await emergencyRepo.tokenContext(trx, current.hospitalId, today());
        await emergencyRepo.writeCase(trx, caseId, {
          state: 'arrived',
          arrived: true,
          tokenLabel: nextTokenLabel(tokens.arrivedToday, tokens.openLabels),
        });
        return notifications.NOTHING;
      });

    case 'decline':
      // `BTN-B07-DECLINE` (`FR-EMG-02`). The family is told, if they left a
      // number, and their screen says so on its next look either way.
      return await act(caseId, 'decline', { reason: body.reason }, actor, async (trx) => {
        await emergencyRepo.writeCase(trx, caseId, {
          state: 'declined',
          closed: true,
          declineReason: body.reason.trim(),
        });
        return await notifications.queueEmergencyAnswer(trx, {
          caseId,
          outcome: 'declined',
          link: trackUrlFor(await caseToken(caseId)),
        });
      });

    case 'triage':
      // `BTN-B07-TRIAGE-<c>` (`FR-EMG-03`).
      return await act(caseId, 'triage', { triage: body.triage }, actor, async (trx) => {
        await emergencyRepo.writeCase(trx, caseId, { triage: body.triage });
        return notifications.NOTHING;
      });

    case 'handoff': {
      // `BTN-B07-ADMIT`: "hands off to ward board with the case attached".
      // A kind of bed the hospital does not have is a handoff nobody can take.
      const kinds = await emergencyRepo.bedKindsAt(actor.hospitalId);
      if (!kinds.includes(body.bedKind)) {
        throw validationFailed({ field: 'bedKind', reason: 'not_at_this_hospital' });
      }
      return await act(caseId, 'handoff', { bedKind: body.bedKind }, actor, async (trx) => {
        await emergencyRepo.writeCase(trx, caseId, { admitBedKind: body.bedKind });
        return notifications.NOTHING;
      });
    }

    case 'discharge':
      // Seen and sent home. Closing the case is what keeps `FR-EMG-04`'s
      // counter honest; a handoff still waiting for a bed is withdrawn with it.
      return await act(caseId, 'discharge', {}, actor, async (trx) => {
        await emergencyRepo.writeCase(trx, caseId, { state: 'discharged', closed: true });
        return notifications.NOTHING;
      });
  }
}

/** `POST /emergency/cases` — walk-in registration, straight onto the triage list. */
export async function walkIn(
  input: {
    readonly problem: EmergencyProblem;
    readonly triage: TriageColor | null;
    readonly phone: string | null;
    readonly ageYears: number | null;
    readonly sex: Sex | null;
    readonly idempotencyKey: string | null;
  },
  actor: ErActor,
): Promise<CaseActionResult> {
  const filed = await withTransaction(async (trx) => {
    if (input.idempotencyKey !== null) {
      await emergencyRepo.lockIdempotencyKey(trx, input.idempotencyKey);
      const existing = await emergencyRepo.findByIdempotencyKey(trx, input.idempotencyKey);
      if (existing !== null) {
        if (existing.hospitalId !== actor.hospitalId) {
          throw forbiddenScope({ reason: 'wrong_hospital' });
        }
        return { id: existing.id, duplicate: true };
      }
    }

    const tokens = await emergencyRepo.tokenContext(trx, actor.hospitalId, today());
    const id = await emergencyRepo.insertWalkIn(trx, {
      hospitalId: actor.hospitalId,
      problem: input.problem,
      triage: input.triage,
      tokenLabel: nextTokenLabel(tokens.arrivedToday, tokens.openLabels),
      phone: input.phone,
      ageYears: input.ageYears,
      sex: input.sex,
      idempotencyKey: input.idempotencyKey,
      createdBy: actor.staffUserId,
    });
    return { id, duplicate: false };
  });

  return await publishCase(filed.id, filed.duplicate);
}

/** `PUT /hospitals/:id/capabilities` — `SW-B07-<capability>` (`FR-EMG-05`). */
export async function confirmCapabilities(
  hospitalId: string,
  entries: readonly { readonly kind: CapabilityKind; readonly available: boolean }[],
  actor: ErActor,
): Promise<{ readonly capabilities: readonly CapabilityRow[]; readonly serverTs: string }> {
  if (hospitalId !== actor.hospitalId) throw forbiddenScope({ reason: 'wrong_hospital' });

  const capabilities = await withTransaction(async (trx) => {
    const declared = new Set(
      (await emergencyRepo.capabilitiesOf(hospitalId, trx)).map((row) => row.kind),
    );
    const undeclared = entries.filter((entry) => !declared.has(entry.kind));
    if (undeclared.length > 0) {
      // Adding a capability is the hospital's setup, not an ER switch.
      throw validationFailed({
        field: 'capabilities',
        reason: 'not_declared_here',
        kinds: undeclared.map((entry) => entry.kind),
      });
    }

    await emergencyRepo.confirmCapabilities(trx, {
      hospitalId,
      entries,
      staffUserId: actor.staffUserId,
    });
    return await emergencyRepo.capabilitiesOf(hospitalId, trx);
  });

  const serverTs = now();
  emit.capabilitiesUpdated(hospitalId, { capabilities }, serverTs);
  return { capabilities, serverTs };
}

/**
 * Broadcasts one case as it now stands, and returns it.
 *
 * Also what the ward calls after placing an ER case in a bed, so the ER
 * console sees the case leave its triage list.
 */
export async function publishCase(caseId: string, duplicate = false): Promise<CaseActionResult> {
  const current = await requiredCase(caseId);
  const load =
    (await emergencyRepo.emergencyFigures([current.hospitalId])).get(current.hospitalId)
      ?.erActive ?? 0;
  const serverTs = now();
  const view = toView(current);

  if (!duplicate) {
    emit.emergencyUpdated(current.hospitalId, { case: view, load }, serverTs);
    if (current.admitRequestedAt !== null) {
      emit.emergencyHandoff(current.hospitalId, { caseId, state: current.state }, serverTs);
    }
  }

  return { case: view, load, duplicate, serverTs };
}

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

/**
 * Steps 1–4 from the header, around one action's write.
 *
 * `actor` is null for the family's own cancel, whose authority is the case
 * token rather than a hospital scope.
 */
async function act(
  caseId: string,
  action: EmergencyAction,
  context: EmergencyActionContext,
  actor: ErActor | null,
  write: (trx: Tx, current: CaseRow) => Promise<notifications.QueuedBatch>,
): Promise<CaseActionResult> {
  const outcome = await withTransaction(async (trx) => {
    const current = await emergencyRepo.lockCase(trx, caseId);
    if (current === null) throw notFound('emergency case');
    if (actor !== null) assertScope(current, actor);

    const verdict = canActOn(current, action, context);
    if (!verdict.ok) {
      if (alreadyApplied(current, action, context)) {
        return { batch: notifications.NOTHING, duplicate: true };
      }
      throw new AppError('EMERGENCY_TRANSITION_INVALID', {
        message: verdict.detail,
        details: { guard: verdict.code, state: current.state },
      });
    }

    return { batch: await write(trx, current), duplicate: false };
  });

  await notifications.dispatch(outcome.batch);
  return await publishCase(caseId, outcome.duplicate);
}

async function requiredCase(caseId: string): Promise<CaseRow> {
  const found = await emergencyRepo.findCase(caseId);
  if (found === null) throw notFound('emergency case');
  return found;
}

async function statusView(caseId: string): Promise<CaseStatusView> {
  const status = await emergencyRepo.caseStatus(caseId);
  if (status === null) throw notFound('emergency case');
  return { ...status, serverTs: now() };
}

/** The console's shape: no patient id, no number. */
function toView(row: CaseRow): EmergencyCaseView {
  const { patientId: _patientId, createdAt: _createdAt, ...view } = row;
  return view;
}

function assertScope(current: CaseRow, actor: ErActor): void {
  if (current.hospitalId !== actor.hospitalId) throw forbiddenScope({ reason: 'wrong_hospital' });
}

async function caseToken(caseId: string): Promise<string> {
  return await signToken({
    kind: 'emergency_case',
    claims: { sub: caseId, kind: 'guest', emergencyCaseId: caseId },
  });
}

async function caseIdFrom(token: string): Promise<string> {
  const verified = await verifyToken(token, 'emergency_case');
  if (!verified.ok) {
    throw verified.reason === 'expired'
      ? new AppError('GUEST_LINK_EXPIRED')
      : new AppError('AUTH_TOKEN_INVALID', { details: { reason: verified.reason } });
  }
  const caseId = verified.claims.emergencyCaseId;
  if (caseId === undefined) {
    throw new AppError('AUTH_TOKEN_INVALID', { details: { reason: 'no_case' } });
  }
  return caseId;
}

/** The family's status page in the patient app (`S-A-10c`). */
function trackUrlFor(token: string): string {
  return `${env.WEB_BASE_URL}/emergency/onway?t=${encodeURIComponent(token)}`;
}

function now(): Timestamp {
  return new Date().toISOString() as Timestamp;
}

function today(): ReturnType<typeof time.toDhakaDate> {
  return time.toDhakaDate(now());
}
