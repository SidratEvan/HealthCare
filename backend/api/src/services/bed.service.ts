/**
 * The bed board (BACKEND.md §7.5, `FR-BED-01`…`07`, `FR-PAT-52`).
 *
 * The one path by which a bed changes, the way `queue.service` is the one
 * path into the queue. Every action here runs the same five steps:
 *
 *   1. **Replay.** A client event id already in `bed_events` is answered with
 *      the bed as it now stands, never applied twice (`SY-02`). An offline ward
 *      console re-sending an admit must not admit a second patient.
 *   2. **Lock.** The beds involved, in id order, and the patient or the
 *      request when there is one. Two consoles tapping the last ICU bed in the
 *      same second get one admit and one clear refusal.
 *   3. **Sweep.** A hold on a locked bed that has lapsed is released first,
 *      with a logged RELEASE by nobody, so every decision is taken against a
 *      bed whose recorded state is its real one.
 *   4. **Decide and write.** The guard is `canApply` from `shared/domain` —
 *      the same function the console ran before it sent the request — and the
 *      event, the bed row and any admission or request are written together.
 *   5. **Publish, after commit.** `bed.updated` with the beds as they now are,
 *      `capacity.updated` with the view's row read back, and messages to a
 *      family whose request was answered. After commit, because a broadcast
 *      of a change that then rolled back is a free bed that never existed.
 *
 * ## Identity
 *
 * The board, the broadcasts and the tiles carry no patient's name. The bed
 * panel and the pending list do, and each read of them writes `audit_log`
 * (`DB-P7`, `FR-SEC-03`) — which is why they are separate calls.
 */

import {
  canActOn,
  canApply,
  canForecastDischarge,
  canReceiveTransfer,
  holdLapsed,
  outcomeOf,
  time,
  type BedAction,
  type BedActionContext,
  type BedKind,
  type BedState,
  type BedView,
  type DhakaDate,
  type PublicCapacity,
  type Timestamp,
  type WardView,
} from '@platform/domain';

import { signToken, verifyToken } from '../config/jwt.js';
import { env } from '../env.js';
import { AppError, forbiddenScope, notFound, validationFailed } from '../errors/AppError.js';
import * as emit from '../realtime/emit.js';
import * as bedRepo from '../repositories/bed.repo.js';
import * as clinicalRepo from '../repositories/clinical.repo.js';
import * as emergencyRepo from '../repositories/emergency.repo.js';
import * as guestRepo from '../repositories/guest.repo.js';
import { withTransaction, type Tx } from '../repositories/transaction.js';

import * as emergency from './emergency.service.js';
import * as notifications from './notification.service.js';

import type { BedRow, BedRequestRow, BedRequestState } from '../repositories/bed.repo.js';
import type { CaseRow } from '../repositories/emergency.repo.js';

/** The staff member acting, and the hospital they act for (`FR-ROLE-01`). */
export interface WardActor {
  readonly staffUserId: string;
  readonly hospitalId: string;
}

/** Idempotency for offline replay (`FR-OFF-01`, SY-02). */
export interface Envelope {
  readonly clientEventId: string | null;
  readonly clientTs: string | null;
}

/** What every bed action returns, and what the console reconciles against. */
export interface BedActionResult {
  /** The beds this action changed, as they now stand. */
  readonly beds: readonly BedView[];
  /** What the public is shown now (`FR-BED-06`). Null for a hospital with no beds. */
  readonly published: PublicCapacity | null;
  /** True when this was a replay of something already applied. */
  readonly duplicate: boolean;
  readonly serverTs: string;
}

// ---------------------------------------------------------------------------
// Reading the board
// ---------------------------------------------------------------------------

/** `GET /hospitals/:id/beds` — everything `S-B-06` draws. */
export interface BedBoard {
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly hospitalNameEn: string;
  readonly wards: readonly WardView[];
  readonly beds: readonly BedView[];
  readonly published: PublicCapacity | null;
  /** `hospital_settings.stale_threshold_minutes` (`FR-OFF-04`). */
  readonly staleAfterMinutes: number;
  /** Dhaka's date, for the discharge forecast (`FR-BED-04`). */
  readonly today: DhakaDate;
  readonly serverTs: string;
}

export async function board(hospitalId: string): Promise<BedBoard> {
  // Opening the board is when a lapsed hold's release gets written. Nothing
  // waited for this to count the bed as free — the view and the domain both
  // already do — but the log should say when the hold ended and that nobody
  // ended it.
  await releaseLapsedHolds(hospitalId);

  const [names, wards, beds, published, staleAfterMinutes] = await Promise.all([
    bedRepo.hospitalNames(hospitalId),
    bedRepo.listWards(hospitalId),
    bedRepo.listBeds(hospitalId),
    publishedFor(hospitalId),
    bedRepo.staleThresholdMinutes(hospitalId),
  ]);
  if (names === null) throw notFound('hospital');

  const serverTs = new Date().toISOString();
  return {
    hospitalId,
    hospitalNameBn: names.nameBn,
    hospitalNameEn: names.nameEn,
    wards,
    beds: beds.map(toView),
    published,
    staleAfterMinutes,
    today: time.toDhakaDate(serverTs as Timestamp),
    serverTs,
  };
}

/** What a bed tile opens onto (`BTN-B06-BED-<bedId>`). **Identifying** when occupied. */
export interface BedPanel {
  readonly bed: BedView;
  readonly occupant: bedRepo.Occupant | null;
}

export async function panel(bedId: string, actor: WardActor): Promise<BedPanel> {
  const bed = await bedRepo.findBed(bedId);
  if (bed === null) throw notFound('bed');
  assertScope(bed, actor);

  const occupant = await bedRepo.occupantOf(bedId);
  if (occupant !== null) {
    // Written after the read succeeds and before it is returned: a refused
    // read leaves no row, and a returned one always has one (`DB-P7`).
    await clinicalRepo.recordRecordView({
      staffUserId: actor.staffUserId,
      userId: null,
      hospitalId: actor.hospitalId,
      patientId: occupant.patientId,
      subjectTable: 'admissions',
      subjectId: occupant.admissionId,
      meta: { surface: 'S-B-06', bedId },
    });
  }

  return { bed: toView(bed), occupant };
}

// ---------------------------------------------------------------------------
// The actions (BACKEND.md §7.5)
// ---------------------------------------------------------------------------

/** The person at the ward desk, as the desk typed them. */
interface AtDesk {
  readonly name: string;
  readonly phone: string;
  readonly ageYears: number;
  readonly sex: 'male' | 'female' | 'other';
}

/**
 * Who is being admitted: a pending request, the person at the desk, or a case
 * the ER handed over — who is also at the desk, and gives their name there
 * (`BTN-B07-ADMIT`, `FR-BED-07`).
 */
export type AdmitWho =
  | { readonly kind: 'request'; readonly bedRequestId: string }
  | ({ readonly kind: 'patient' } & AtDesk)
  | ({ readonly kind: 'emergency'; readonly emergencyCaseId: string } & AtDesk);

/** `POST /beds/:id/admit` (`BTN-B06-ADMIT`). */
export async function admit(
  input: {
    readonly bedId: string;
    readonly who: AdmitWho;
    readonly expectedDischargeDate: string | null;
  } & Envelope,
  actor: WardActor,
): Promise<BedActionResult> {
  return await run([input.bedId], input, actor, async (trx, [bed]) => {
    const who = input.who;
    const request =
      who.kind === 'request' ? await pendingRequest(trx, who.bedRequestId, actor) : null;
    const emergencyCase =
      who.kind === 'emergency' ? await handedOffCase(trx, who.emergencyCaseId, actor) : null;

    const patientId =
      who.kind === 'request' ? (request?.patientId ?? '') : await patientAtDesk(trx, who);

    await admitInto(trx, {
      bed: required(bed),
      patientId,
      request,
      emergencyCaseId: emergencyCase?.id ?? null,
      expectedDischargeDate: input.expectedDischargeDate,
      actor,
      envelope: input,
    });

    // The case leaves the ER's list and the ward's: it is a stay now, and it
    // names the person it has become.
    if (emergencyCase !== null) {
      await emergencyRepo.writeCase(trx, emergencyCase.id, {
        state: 'admitted',
        closed: true,
        patientId,
      });
    }

    return {
      bedIds: [required(bed).id],
      requests: request === null ? [] : [request.id],
      cases: emergencyCase === null ? [] : [emergencyCase.id],
    };
  });
}

/** `POST /beds/:id/discharge` (`BTN-B06-DISCHARGE`) — into cleaning, never straight to free. */
export async function discharge(
  input: { readonly bedId: string } & Envelope,
  actor: WardActor,
): Promise<BedActionResult> {
  return await run([input.bedId], input, actor, async (trx, [locked]) => {
    const bed = required(locked);
    guard(bed, 'discharge');
    const admissionId = bed.admissionId;
    if (admissionId === null) throw new Error(`Occupied bed ${bed.id} names no admission.`);

    await bedRepo.closeAdmission(trx, admissionId);
    await record(trx, bed, 'discharge', actor, input, { admissionId });
    await bedRepo.writeBed(trx, bed.id, cleared('cleaning'));

    return { bedIds: [bed.id], requests: [] };
  });
}

/** `POST /beds/:id/transfer` (`BTN-B06-TRANSFER`) — "both tiles update". */
export async function transfer(
  input: { readonly bedId: string; readonly toBedId: string } & Envelope,
  actor: WardActor,
): Promise<BedActionResult> {
  return await run([input.bedId, input.toBedId], input, actor, async (trx, locked) => {
    const source = locked.find((bed) => bed.id === input.bedId);
    const target = locked.find((bed) => bed.id === input.toBedId);
    if (source === undefined || target === undefined) throw notFound('bed');

    guard(source, 'transfer');
    const verdict = canReceiveTransfer(source, target, now());
    if (!verdict.ok) throw transitionInvalid(verdict.code, verdict.detail);

    const admissionId = source.admissionId;
    if (admissionId === null) throw new Error(`Occupied bed ${source.id} names no admission.`);

    await bedRepo.moveAdmission(trx, admissionId, target.id);

    // Two facts, one per bed. Only the bed left carries the console's event
    // id: that is the bed the action was taken on, and the one a replay is
    // recognised by.
    await record(trx, source, 'transfer', actor, input, {
      admissionId,
      payload: { toBedId: target.id, toLabel: target.label },
    });
    await bedRepo.appendEvent(trx, {
      hospitalId: target.hospitalId,
      bedId: target.id,
      type: 'TRANSFER',
      from: target.state,
      to: 'occupied',
      admissionId,
      bedRequestId: null,
      actorStaffId: actor.staffUserId,
      payload: { fromBedId: source.id, fromLabel: source.label },
      clientEventId: null,
      clientTs: input.clientTs,
    });

    await bedRepo.writeBed(trx, source.id, cleared('cleaning'));
    await bedRepo.writeBed(trx, target.id, {
      ...cleared('occupied'),
      admissionId,
      // The forecast belongs to the stay, not the bed, so it moves with it.
      expectedDischargeDate: source.expectedDischargeDate,
    });

    return { bedIds: [source.id, target.id], requests: [] };
  });
}

/** `POST /beds/:id/reserve` (`BTN-B06-RESERVE`) — "hold with expiry". */
export async function reserve(
  input: { readonly bedId: string; readonly minutes: number } & Envelope,
  actor: WardActor,
): Promise<BedActionResult> {
  return await run([input.bedId], input, actor, async (trx, [locked]) => {
    const bed = required(locked);
    guard(bed, 'reserve', { holdMinutes: input.minutes });

    const until = new Date(Date.now() + input.minutes * 60_000);
    await record(trx, bed, 'reserve', actor, input, {
      payload: { minutes: input.minutes, reservedUntil: until.toISOString() },
    });
    await bedRepo.writeBed(trx, bed.id, { ...cleared('reserved'), reservedUntil: until });

    return { bedIds: [bed.id], requests: [] };
  });
}

/** `POST /beds/:id/release` — ends a hold by hand. */
export async function release(
  input: { readonly bedId: string } & Envelope,
  actor: WardActor,
): Promise<BedActionResult> {
  return await run([input.bedId], input, actor, async (trx, [locked]) => {
    const bed = required(locked);
    guard(bed, 'release');

    // A hold made for a family is ended by answering the family — confirm or
    // decline in the pending list — so they are told. Releasing the bed from
    // under a request would leave the patient app counting down to a bed that
    // is no longer theirs.
    if (bed.heldForRequestId !== null) {
      throw transitionInvalid(
        'HELD_FOR_REQUEST',
        'This bed is held for a request. Admit or decline the request instead.',
      );
    }

    await record(trx, bed, 'release', actor, input);
    await bedRepo.writeBed(trx, bed.id, cleared('free'));
    return { bedIds: [bed.id], requests: [] };
  });
}

/** `POST /beds/:id/clean-start` — a free bed sent for cleaning. */
export async function cleanStart(
  input: { readonly bedId: string } & Envelope,
  actor: WardActor,
): Promise<BedActionResult> {
  return await simple('clean_start', 'cleaning', input, actor);
}

/** `POST /beds/:id/clean-done` — "then free", because a person said so. */
export async function cleanDone(
  input: { readonly bedId: string } & Envelope,
  actor: WardActor,
): Promise<BedActionResult> {
  return await run([input.bedId], input, actor, async (trx, [locked]) => {
    const bed = required(locked);
    guard(bed, 'clean_done');
    await record(trx, bed, 'clean_done', actor, input);
    await bedRepo.writeBed(trx, bed.id, { ...cleared('free'), cleaned: true });
    return { bedIds: [bed.id], requests: [] };
  });
}

/** `POST /beds/:id/oos` (`BTN-B06-OOS`) — "marks out of service with reason". */
export async function outOfService(
  input: { readonly bedId: string; readonly reason: string } & Envelope,
  actor: WardActor,
): Promise<BedActionResult> {
  return await run([input.bedId], input, actor, async (trx, [locked]) => {
    const bed = required(locked);
    guard(bed, 'oos', { reason: input.reason });
    const reason = input.reason.trim();
    await record(trx, bed, 'oos', actor, input, { payload: { reason } });
    await bedRepo.writeBed(trx, bed.id, { ...cleared('out_of_service'), oosReason: reason });
    return { bedIds: [bed.id], requests: [] };
  });
}

/** `POST /beds/:id/restore` — back in service. */
export async function restore(
  input: { readonly bedId: string } & Envelope,
  actor: WardActor,
): Promise<BedActionResult> {
  return await simple('restore', 'free', input, actor);
}

/**
 * `POST /beds/:id/expected-discharge` (`SEL-B06-EXPDIS`, `FR-BED-04`).
 *
 * Not an event. `bed_events.type` has no forecast type, and a forecast is not
 * a change to the bed — nothing the public sees moves when it is set. Setting
 * the same date twice is the same as setting it once, which is what makes an
 * offline replay of it safe without an event id to find it by.
 */
export async function forecastDischarge(
  input: { readonly bedId: string; readonly date: string | null } & Envelope,
  actor: WardActor,
): Promise<BedActionResult> {
  return await run(
    [input.bedId],
    { ...input, clientEventId: null },
    actor,
    async (trx, [locked]) => {
      const bed = required(locked);
      const verdict = canForecastDischarge(bed, input.date as DhakaDate | null, today());
      if (!verdict.ok) throw transitionInvalid(verdict.code, verdict.detail);

      const admissionId = bed.admissionId;
      if (admissionId === null) throw new Error(`Occupied bed ${bed.id} names no admission.`);

      await bedRepo.writeDischargeForecast(trx, { bedId: bed.id, admissionId, date: input.date });
      return { bedIds: [bed.id], requests: [] };
    },
  );
}

// ---------------------------------------------------------------------------
// Bed requests (`FR-PAT-52`, `FR-BED-07`)
// ---------------------------------------------------------------------------

/** What a family's status screen shows. Its state already accounts for a lapsed hold. */
export interface RequestView extends Omit<bedRepo.RequestStatus, 'state'> {
  readonly state: BedRequestState;
  readonly serverTs: string;
}

export interface CreatedRequest {
  readonly request: RequestView;
  /** The family's status link. Returned here and in the SMS, stored nowhere. */
  readonly token: string;
  readonly trackUrl: string;
  /** True when this phone already had an open request here, which is returned instead. */
  readonly duplicate: boolean;
}

/** `POST /bed-requests` — `MOD-A11-REQUEST`. No account needed (`FR-GST-01`). */
export async function createRequest(input: {
  readonly hospitalId: string;
  readonly bedKind: BedKind;
  readonly patient: {
    readonly name: string;
    readonly phone: string;
    readonly ageYears: number;
    readonly sex: 'male' | 'female' | 'other';
  };
  readonly note: string | null;
  readonly expectedArrivalAt: string | null;
  readonly idempotencyKey: string | null;
}): Promise<CreatedRequest> {
  if (!(await bedRepo.hospitalExists(input.hospitalId))) throw notFound('hospital');

  // A request for a kind of bed the hospital does not have is a family told
  // "we'll let you know" by a ward that cannot say yes.
  const offering = await bedRepo.hospitalsWithKind(input.bedKind);
  if (!offering.has(input.hospitalId)) {
    throw validationFailed({ field: 'bedKind', reason: 'not_offered_here' });
  }

  const filed = await withTransaction(async (trx) => {
    const guestId = await guestRepo.findOrCreateIdentity(trx, {
      phone: input.patient.phone,
      displayName: input.patient.name,
    });
    const patientId = await guestRepo.findOrCreatePatient(trx, {
      guestId,
      fullName: input.patient.name,
      ageYears: input.patient.ageYears,
      sex: input.patient.sex,
      phone: input.patient.phone,
    });

    // A second tap on the same button is the same request (`bed_requests_one_open_key`).
    const existing = await bedRepo.findExistingRequest(trx, {
      idempotencyKey: input.idempotencyKey,
      patientId,
      hospitalId: input.hospitalId,
    });
    if (existing !== null) return { request: existing, guestId, duplicate: true };

    const request = await bedRepo.insertRequest(trx, {
      hospitalId: input.hospitalId,
      patientId,
      bedKind: input.bedKind,
      guestId,
      note: input.note,
      expectedArrivalAt: input.expectedArrivalAt,
      idempotencyKey: input.idempotencyKey,
    });
    return { request, guestId, duplicate: false };
  });

  const token = await statusToken(filed.request.id, filed.guestId);
  const serverTs = new Date().toISOString();

  if (!filed.duplicate) {
    emit.bedRequestUpdated(
      input.hospitalId,
      { requestId: filed.request.id, state: filed.request.state },
      serverTs,
    );
  }

  return {
    request: await requestView(filed.request.id),
    token,
    trackUrl: trackUrlFor(token),
    duplicate: filed.duplicate,
  };
}

/** `GET /bed-requests/track/:token` — the family's view of their request. */
export async function trackRequest(token: string): Promise<RequestView> {
  const verified = await verifyToken(token, 'bed_request');
  if (!verified.ok) {
    throw verified.reason === 'expired'
      ? new AppError('GUEST_LINK_EXPIRED')
      : new AppError('AUTH_TOKEN_INVALID', { details: { reason: verified.reason } });
  }

  const requestId = verified.claims.bedRequestId;
  if (requestId === undefined) {
    throw new AppError('AUTH_TOKEN_INVALID', { details: { reason: 'no_request' } });
  }

  return await requestView(requestId);
}

/**
 * One case the ER handed to the ward (`BTN-B07-ADMIT`) — the ER half of
 * `LIST-B06-PENDING` (`FR-BED-07`). Names nobody: the ward takes the name at
 * the bed, so this half of the list is not an identifying read.
 */
export interface PendingHandoff {
  readonly caseId: string;
  readonly tokenLabel: string | null;
  readonly problem: string;
  readonly triage: string | null;
  readonly ageYears: number | null;
  readonly sex: string | null;
  readonly bedKind: BedKind;
  readonly requestedAt: string;
}

/** `GET /hospitals/:id/bed-requests` — `LIST-B06-PENDING`. **Identifying**: audited. */
export async function pending(
  hospitalId: string,
  actor: WardActor,
): Promise<{
  readonly requests: readonly bedRepo.PendingRequest[];
  readonly handoffs: readonly PendingHandoff[];
  readonly serverTs: string;
}> {
  // A lapsed hold leaves the pending list when it lapses, not when somebody
  // next opens the board.
  await releaseLapsedHolds(hospitalId);

  const [requests, cases] = await Promise.all([
    bedRepo.pendingRequests(hospitalId),
    emergencyRepo.handoffs(hospitalId),
  ]);
  const handoffs = cases.flatMap((entry): PendingHandoff[] =>
    entry.admitBedKind === null || entry.admitRequestedAt === null
      ? []
      : [
          {
            caseId: entry.id,
            tokenLabel: entry.tokenLabel,
            problem: entry.problem,
            triage: entry.triage,
            ageYears: entry.ageYears,
            sex: entry.sex,
            bedKind: entry.admitBedKind,
            requestedAt: entry.admitRequestedAt,
          },
        ],
  );

  for (const request of requests) {
    await clinicalRepo.recordRecordView({
      staffUserId: actor.staffUserId,
      userId: null,
      hospitalId,
      patientId: request.patientId,
      subjectTable: 'bed_requests',
      subjectId: request.id,
      meta: { surface: 'LIST-B06-PENDING' },
    });
  }

  return { requests, handoffs, serverTs: new Date().toISOString() };
}

export type RespondInput =
  | ({ readonly action: 'hold'; readonly bedId: string; readonly minutes: number } & Envelope)
  | ({ readonly action: 'confirm'; readonly bedId: string | null } & Envelope)
  | ({ readonly action: 'decline' } & Envelope);

/** `POST /bed-requests/:id/respond` — hold, confirm (admit), or decline. */
export async function respond(
  requestId: string,
  input: RespondInput,
  actor: WardActor,
): Promise<BedActionResult & { readonly request: RequestView }> {
  const request = await bedRepo.findRequest(requestId);
  if (request === null) throw notFound('bed request');
  if (request.hospitalId !== actor.hospitalId) throw forbiddenScope({ reason: 'wrong_hospital' });

  const bedIds =
    input.action === 'decline'
      ? request.bedId === null
        ? []
        : [request.bedId]
      : [input.bedId ?? request.bedId ?? ''];

  if (bedIds.includes('')) {
    throw validationFailed({ field: 'bedId', reason: 'required_without_a_hold' });
  }

  const result = await run(bedIds, input, actor, async (trx, locked) => {
    const current = await pendingRequest(trx, requestId, actor);
    const link = trackUrlFor(
      await statusToken(current.id, current.requestedByGuestId ?? current.patientId),
    );

    switch (input.action) {
      case 'hold': {
        const bed = required(locked[0]);
        if (current.state !== 'requested') {
          throw conflict('request_already_answered', 'That request has already been answered.');
        }
        if (bed.kind !== current.bedKind) {
          throw transitionInvalid(
            'KIND_MISMATCH',
            `The family asked for a ${current.bedKind} bed; hold one of those.`,
          );
        }
        guard(bed, 'reserve', { holdMinutes: input.minutes });

        const until = new Date(Date.now() + input.minutes * 60_000);
        await record(trx, bed, 'reserve', actor, input, {
          bedRequestId: current.id,
          payload: { minutes: input.minutes, reservedUntil: until.toISOString() },
        });
        await bedRepo.writeBed(trx, bed.id, { ...cleared('reserved'), reservedUntil: until });
        await bedRepo.answerRequest(trx, {
          requestId: current.id,
          state: 'held',
          bedId: bed.id,
          holdExpiresAt: until,
          respondedBy: actor.staffUserId,
        });

        return {
          bedIds: [bed.id],
          requests: [current.id],
          batch: await notifications.queueBedRequestAnswer(trx, {
            requestId: current.id,
            outcome: 'held',
            holdExpiresAt: until.toISOString(),
            link,
          }),
        };
      }

      case 'confirm': {
        const bed = required(locked[0]);
        await admitInto(trx, {
          bed,
          patientId: current.patientId,
          request: current,
          emergencyCaseId: null,
          expectedDischargeDate: null,
          actor,
          envelope: input,
        });
        return { bedIds: [bed.id], requests: [current.id] };
      }

      case 'decline': {
        // A held bed goes back to the public count when the family is told no.
        const held = locked.find((bed) => bed.heldForRequestId === current.id);
        if (held !== undefined) {
          await record(trx, held, 'release', actor, input, {
            bedRequestId: current.id,
            payload: { reason: 'request_declined' },
          });
          await bedRepo.writeBed(trx, held.id, cleared('free'));
        }
        await bedRepo.answerRequest(trx, {
          requestId: current.id,
          state: 'declined',
          bedId: current.bedId,
          holdExpiresAt: current.holdExpiresAt === null ? null : new Date(current.holdExpiresAt),
          respondedBy: actor.staffUserId,
        });

        return {
          bedIds: held === undefined ? [] : [held.id],
          requests: [current.id],
          batch: await notifications.queueBedRequestAnswer(trx, {
            requestId: current.id,
            outcome: 'declined',
            holdExpiresAt: null,
            link,
          }),
        };
      }
    }
  });

  return { ...result, request: await requestView(requestId) };
}

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

/** What one action's body reports back to `run`. */
interface Changed {
  readonly bedIds: readonly string[];
  readonly requests: readonly string[];
  /** ER cases this action placed, so the ER console sees them leave (`FR-BED-07`). */
  readonly cases?: readonly string[];
  readonly batch?: notifications.QueuedBatch;
}

/**
 * Steps 1–5 from the header, around one action's body.
 *
 * `bedIds` may be empty — a decline of a request that was never held touches
 * no bed — and then nothing is locked and the body decides alone.
 */
async function run(
  bedIds: readonly string[],
  envelope: Envelope,
  actor: WardActor,
  body: (trx: Tx, locked: readonly BedRow[]) => Promise<Changed>,
): Promise<BedActionResult> {
  // --- 1. Replay ------------------------------------------------------------
  if (envelope.clientEventId !== null) {
    const replayed = await bedRepo.findReplay(envelope.clientEventId);
    if (replayed !== null) {
      if (replayed.hospitalId !== actor.hospitalId)
        throw forbiddenScope({ reason: 'wrong_hospital' });
      return {
        beds: await currentBeds(
          replayed.hospitalId,
          bedIds.length === 0 ? [replayed.bedId] : bedIds,
        ),
        published: await publishedFor(replayed.hospitalId),
        duplicate: true,
        serverTs: replayed.serverTs,
      };
    }
  }

  const changed = await withTransaction(async (trx) => {
    // --- 2. Lock ------------------------------------------------------------
    const unique = [...new Set(bedIds)];
    let locked = unique.length === 0 ? [] : await bedRepo.lockBeds(trx, unique);
    if (locked.length !== unique.length) throw notFound('bed');
    for (const bed of locked) assertScope(bed, actor);

    // --- 3. Sweep -----------------------------------------------------------
    const lapsedRequests: string[] = [];
    if (locked.some((bed) => holdLapsed(bed, now()))) {
      for (const bed of locked.filter((candidate) => holdLapsed(candidate, now()))) {
        const request = await releaseOne(trx, bed);
        if (request !== null) lapsedRequests.push(request);
      }
      locked = await bedRepo.lockBeds(trx, unique);
    }

    // --- 4. Decide and write ------------------------------------------------
    const result = await body(trx, locked);
    return { ...result, requests: [...result.requests, ...lapsedRequests] };
  });

  // --- 5. Publish, after commit ----------------------------------------------
  if (changed.batch !== undefined) await notifications.dispatch(changed.batch);
  const result = await publish(actor.hospitalId, changed.bedIds, changed.requests);
  for (const caseId of changed.cases ?? []) await emergency.publishCase(caseId);
  return result;
}

/** An action that is nothing but a state change on one bed. */
async function simple(
  action: BedAction,
  to: BedState,
  input: { readonly bedId: string } & Envelope,
  actor: WardActor,
): Promise<BedActionResult> {
  return await run([input.bedId], input, actor, async (trx, [locked]) => {
    const bed = required(locked);
    guard(bed, action);
    await record(trx, bed, action, actor, input);
    await bedRepo.writeBed(trx, bed.id, cleared(to));
    return { bedIds: [bed.id], requests: [] };
  });
}

/**
 * The admit itself, shared by `BTN-B06-ADMIT` and a request's confirm.
 *
 * The patient row is locked before anything is written, so the same person
 * admitted from two consoles at once lands in one bed and the second console
 * is told where.
 */
async function admitInto(
  trx: Tx,
  input: {
    readonly bed: BedRow;
    readonly patientId: string;
    readonly request: BedRequestRow | null;
    /** A case the ER handed over; the stay's source is then the ER. */
    readonly emergencyCaseId: string | null;
    readonly expectedDischargeDate: string | null;
    readonly actor: WardActor;
    readonly envelope: Envelope;
  },
): Promise<void> {
  const { bed, request, actor } = input;
  const source = input.emergencyCaseId !== null ? 'er' : request === null ? 'opd' : 'app_request';

  guard(bed, 'admit', { bedRequestId: request?.id ?? null });

  // A family whose request is held for one bed is admitted into that bed.
  if (request?.state === 'held' && request.bedId !== bed.id) {
    throw transitionInvalid('HELD_ELSEWHERE', 'This request is holding a different bed.');
  }

  if (input.expectedDischargeDate !== null && input.expectedDischargeDate < today()) {
    throw transitionInvalid('DISCHARGE_DATE_PAST', 'An expected discharge cannot be in the past.');
  }

  const patient = await bedRepo.lockPatientForAdmit(trx, input.patientId);
  if (!patient.exists) throw notFound('patient');
  if (patient.openAdmissionBedId !== null) {
    throw conflict('patient_already_admitted', 'This patient is already in a bed.', {
      bedId: patient.openAdmissionBedId,
    });
  }

  const admissionId = await bedRepo.insertAdmission(trx, {
    patientId: input.patientId,
    hospitalId: bed.hospitalId,
    bedId: bed.id,
    source,
    bedRequestId: request?.id ?? null,
    emergencyCaseId: input.emergencyCaseId,
    expectedDischargeDate: input.expectedDischargeDate,
    createdBy: actor.staffUserId,
  });

  await record(trx, bed, 'admit', actor, input.envelope, {
    admissionId,
    bedRequestId: request?.id ?? null,
    payload: { source },
  });

  await bedRepo.writeBed(trx, bed.id, {
    ...cleared('occupied'),
    admissionId,
    expectedDischargeDate: input.expectedDischargeDate,
  });

  if (request !== null) {
    await bedRepo.answerRequest(trx, {
      requestId: request.id,
      state: 'confirmed',
      bedId: bed.id,
      holdExpiresAt: request.holdExpiresAt === null ? null : new Date(request.holdExpiresAt),
      respondedBy: actor.staffUserId,
    });
  }
}

/** The person at the ward desk, found or registered (`FR-GST-13`). */
async function patientAtDesk(trx: Tx, who: AtDesk): Promise<string> {
  const guestId = await guestRepo.findOrCreateIdentity(trx, {
    phone: who.phone,
    displayName: who.name,
  });
  return await guestRepo.findOrCreatePatient(trx, {
    guestId,
    fullName: who.name,
    ageYears: who.ageYears,
    sex: who.sex,
    phone: who.phone,
  });
}

/**
 * A case the ER at this hospital handed to the ward and nobody has placed yet,
 * locked. The guard is the ER's own (`canActOn(…, 'admit')`), so the ward
 * cannot admit a case the ER never handed over or has since discharged.
 */
async function handedOffCase(trx: Tx, caseId: string, actor: WardActor): Promise<CaseRow> {
  const found = await emergencyRepo.lockCase(trx, caseId);
  if (found === null) throw notFound('emergency case');
  if (found.hospitalId !== actor.hospitalId) throw forbiddenScope({ reason: 'wrong_hospital' });

  const verdict = canActOn(found, 'admit');
  if (!verdict.ok) {
    throw new AppError('EMERGENCY_TRANSITION_INVALID', {
      message: verdict.detail,
      details: { guard: verdict.code, state: found.state },
    });
  }
  return found;
}

/** A request still waiting for this hospital's answer, locked. */
async function pendingRequest(
  trx: Tx,
  requestId: string,
  actor: WardActor,
): Promise<BedRequestRow> {
  const request = await bedRepo.lockRequest(trx, requestId);
  if (request === null) throw notFound('bed request');
  if (request.hospitalId !== actor.hospitalId) throw forbiddenScope({ reason: 'wrong_hospital' });
  if (request.state !== 'requested' && request.state !== 'held') {
    throw conflict('request_not_pending', 'That request is no longer waiting for an answer.', {
      state: request.state,
    });
  }
  return request;
}

/**
 * Writes the event for `action` on `bed`, from the state the bed is recorded
 * in to the state the action produces.
 */
async function record(
  trx: Tx,
  bed: BedRow,
  action: BedAction,
  actor: WardActor,
  envelope: Envelope,
  extra: {
    readonly admissionId?: string | null;
    readonly bedRequestId?: string | null;
    readonly payload?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const { type, to } = outcomeOf(action);
  await bedRepo.appendEvent(trx, {
    hospitalId: bed.hospitalId,
    bedId: bed.id,
    type,
    from: bed.state,
    to,
    admissionId: extra.admissionId ?? null,
    bedRequestId: extra.bedRequestId ?? null,
    actorStaffId: actor.staffUserId,
    payload: extra.payload ?? {},
    clientEventId: envelope.clientEventId,
    clientTs: envelope.clientTs,
  });
}

/** Releases one lapsed hold, by nobody. Returns the request it expired, if any. */
async function releaseOne(trx: Tx, bed: BedRow): Promise<string | null> {
  await bedRepo.appendEvent(trx, {
    hospitalId: bed.hospitalId,
    bedId: bed.id,
    type: 'RELEASE',
    from: 'reserved',
    to: 'free',
    admissionId: null,
    bedRequestId: bed.heldForRequestId,
    actorStaffId: null,
    payload: { reason: 'hold_lapsed', reservedUntil: bed.reservedUntil },
    clientEventId: null,
    clientTs: null,
  });
  await bedRepo.writeBed(trx, bed.id, cleared('free'));

  if (bed.heldForRequestId === null) return null;
  const request = await bedRepo.findRequest(bed.heldForRequestId, trx);
  await bedRepo.answerRequest(trx, {
    requestId: bed.heldForRequestId,
    state: 'expired',
    bedId: bed.id,
    holdExpiresAt:
      request?.holdExpiresAt === null || request === null ? null : new Date(request.holdExpiresAt),
    respondedBy: null,
  });
  return bed.heldForRequestId;
}

/** Writes every lapsed hold's release at one hospital, and says so. */
async function releaseLapsedHolds(hospitalId: string): Promise<void> {
  const released = await withTransaction(async (trx) => {
    const lapsed = await bedRepo.lockLapsedHolds(trx, hospitalId);
    const requests: string[] = [];
    for (const bed of lapsed) {
      const request = await releaseOne(trx, bed);
      if (request !== null) requests.push(request);
    }
    return { bedIds: lapsed.map((bed) => bed.id), requests };
  });

  if (released.bedIds.length > 0) await publish(hospitalId, released.bedIds, released.requests);
}

/** Broadcasts what changed and returns it, reading everything back after commit. */
async function publish(
  hospitalId: string,
  bedIds: readonly string[],
  requestIds: readonly string[],
): Promise<BedActionResult> {
  const [beds, published] = await Promise.all([
    currentBeds(hospitalId, bedIds),
    publishedFor(hospitalId),
  ]);
  const serverTs = new Date().toISOString();

  if (beds.length > 0) emit.bedUpdated(hospitalId, { beds }, serverTs);
  if (published !== null) emit.capacityUpdated(hospitalId, published, serverTs);

  for (const requestId of new Set(requestIds)) {
    const request = await bedRepo.findRequest(requestId);
    if (request !== null) {
      emit.bedRequestUpdated(hospitalId, { requestId, state: request.state }, serverTs);
    }
  }

  return { beds, published, duplicate: false, serverTs };
}

async function currentBeds(hospitalId: string, bedIds: readonly string[]): Promise<BedView[]> {
  if (bedIds.length === 0) return [];
  const wanted = new Set(bedIds);
  return (await bedRepo.listBeds(hospitalId)).filter((bed) => wanted.has(bed.id)).map(toView);
}

async function publishedFor(hospitalId: string): Promise<PublicCapacity | null> {
  return (await bedRepo.publicCapacity([hospitalId])).get(hospitalId) ?? null;
}

async function requestView(requestId: string): Promise<RequestView> {
  const status = await bedRepo.requestStatus(requestId);
  if (status === null) throw notFound('bed request');

  // A hold that has run out is expired to the family the moment it runs out,
  // whether or not the ward has opened its board since. Reading does not
  // write; the board writes the release when it next opens.
  const lapsed =
    status.state === 'held' &&
    status.holdExpiresAt !== null &&
    Date.parse(status.holdExpiresAt) <= Date.now();

  return {
    ...status,
    state: lapsed ? 'expired' : status.state,
    serverTs: new Date().toISOString(),
  };
}

async function statusToken(requestId: string, subject: string): Promise<string> {
  return await signToken({
    kind: 'bed_request',
    claims: { sub: subject, kind: 'guest', bedRequestId: requestId },
  });
}

/** The family's status page in the patient app. */
function trackUrlFor(token: string): string {
  return `${env.WEB_BASE_URL}/beds/request?t=${encodeURIComponent(token)}`;
}

function guard(bed: BedRow, action: BedAction, context: BedActionContext = {}): void {
  const verdict = canApply(bed, action, now(), context);
  if (!verdict.ok) throw transitionInvalid(verdict.code, verdict.detail);
}

function assertScope(bed: BedRow, actor: WardActor): void {
  if (bed.hospitalId !== actor.hospitalId) throw forbiddenScope({ reason: 'wrong_hospital' });
}

function transitionInvalid(code: string, detail: string): AppError {
  return new AppError('BED_TRANSITION_INVALID', { message: detail, details: { guard: code } });
}

function conflict(reason: string, detail: string, extra: Record<string, unknown> = {}): AppError {
  return new AppError('BED_CONFLICT', { message: detail, details: { reason, ...extra } });
}

/** A bed moved to `state` with every other state's fields cleared. */
function cleared(state: BedState): bedRepo.BedWrite {
  return {
    state,
    admissionId: null,
    expectedDischargeDate: null,
    reservedUntil: null,
    oosReason: null,
  };
}

function required(bed: BedRow | undefined): BedRow {
  if (bed === undefined) throw notFound('bed');
  return bed;
}

/** The board's shape: the bed without the hospital it belongs to, which the room already says. */
function toView(bed: BedRow): BedView {
  return {
    id: bed.id,
    wardId: bed.wardId,
    label: bed.label,
    kind: bed.kind,
    state: bed.state,
    nightlyPoisha: bed.nightlyPoisha,
    lastCleanedAt: bed.lastCleanedAt,
    stateChangedAt: bed.stateChangedAt,
    expectedDischargeDate: bed.expectedDischargeDate,
    reservedUntil: bed.reservedUntil,
    oosReason: bed.oosReason,
    admissionId: bed.admissionId,
    heldForRequestId: bed.heldForRequestId,
  };
}

function now(): Timestamp {
  return new Date().toISOString() as Timestamp;
}

function today(): DhakaDate {
  return time.toDhakaDate(now());
}
