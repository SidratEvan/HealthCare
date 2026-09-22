/**
 * Referrals between ERs: send, see, answer, withdraw, arrive (BACKEND.md §7.5;
 * `FR-EMG-07..09`).
 *
 * ## Every step runs the same way
 *
 *   1. **Lock** the referral row. The receiving ER accepting and the sending ER
 *      withdrawing at the same moment serialise on it.
 *   2. **Decide** with `canActOnReferral` — the function both consoles ran
 *      before sending. A console acting on the other side's step is refused
 *      outright. An action whose outcome is already the referral's is a replay
 *      (`referralAlreadyApplied`), answered as a success without writing.
 *   3. **Write**, in one transaction with anything the step does to a case.
 *   4. **After commit**, broadcast `referral.updated` to both ERs — never
 *      before, so no console shows a step that rolled back.
 *
 * ## Arrival is the handover
 *
 * The owner's ruling (2026-09-22): the sending ER keeps the case — on its
 * triage list, in its load — until the receiving ER records that the person
 * has arrived. `arrive` therefore does three things in one transaction: opens
 * a case at the receiving ER with a token (the summary's problem, colour, age
 * and sex; no phone, which stays with the ER that was given it), closes the
 * sending ER's case as `referred`, and stamps the referral. Both ERs' cases
 * are broadcast after commit, so the person leaves one list and joins the
 * other together.
 *
 * ## Identity
 *
 * A referral names nobody, and nothing here reads a name or a number, so no
 * step writes `audit_log`: the same reasoning that leaves the ER console's
 * list unaudited (`DB-P7`).
 */

import {
  canActOn,
  canActOnReferral,
  canRefer,
  nextTokenLabel,
  referralAlreadyApplied,
  sideOf,
  time,
  type BedKind,
  type CapabilityKind,
  type ReferralAction,
  type ReferralView,
  type Timestamp,
} from '@platform/domain';

import { AppError, forbiddenScope, notFound, validationFailed } from '../errors/AppError.js';
import * as emit from '../realtime/emit.js';
import * as emergencyRepo from '../repositories/emergency.repo.js';
import * as referralRepo from '../repositories/referral.repo.js';
import { withTransaction, type Tx } from '../repositories/transaction.js';

import * as emergency from './emergency.service.js';

import type { ErActor } from './emergency.service.js';

/** What every referral endpoint returns, and what a console reconciles against. */
export interface ReferralResult {
  readonly referral: ReferralView;
  /** True when this was a replay of something already applied. */
  readonly duplicate: boolean;
  readonly serverTs: string;
}

// ---------------------------------------------------------------------------
// Send (`BTN-B07-REFER-SEND-<hospitalId>`, `FR-EMG-08`)
// ---------------------------------------------------------------------------

export async function send(
  input: {
    readonly emergencyCaseId: string;
    readonly toHospitalId: string;
    readonly requiredCapability: CapabilityKind | null;
    readonly requiredBedKind: BedKind | null;
    readonly note: string | null;
    readonly idempotencyKey: string | null;
  },
  actor: ErActor,
): Promise<ReferralResult> {
  if (input.toHospitalId === actor.hospitalId) {
    throw validationFailed({ field: 'toHospitalId', reason: 'same_hospital' });
  }
  // Only an ER with somebody to answer: a referral to a facility with no ER
  // console would wait on nobody while this ER held the person for it.
  if (!(await emergencyRepo.hasEmergencyDesk(input.toHospitalId))) {
    throw validationFailed({ field: 'toHospitalId', reason: 'no_emergency_department' });
  }

  const filed = await withTransaction(async (trx) => {
    if (input.idempotencyKey !== null) {
      await referralRepo.lockIdempotencyKey(trx, input.idempotencyKey);
      const existing = await referralRepo.findByIdempotencyKey(trx, input.idempotencyKey);
      if (existing !== null) {
        if (existing.from.hospitalId !== actor.hospitalId) {
          throw forbiddenScope({ reason: 'wrong_hospital' });
        }
        if (
          existing.emergencyCaseId !== input.emergencyCaseId ||
          existing.to.hospitalId !== input.toHospitalId
        ) {
          throw validationFailed({
            field: 'Idempotency-Key',
            reason: 'reused_for_another_referral',
          });
        }
        return { id: existing.id, duplicate: true };
      }
    }

    // The case is locked for the rest of the transaction, so a discharge or a
    // second referral racing this one decides against what this one wrote.
    const current = await emergencyRepo.lockCase(trx, input.emergencyCaseId);
    if (current === null) throw notFound('emergency case');
    if (current.hospitalId !== actor.hospitalId) throw forbiddenScope({ reason: 'wrong_hospital' });

    const open = await referralRepo.openReferralOf(trx, current.id);
    const verdict = canRefer(current, open !== null);
    if (!verdict.ok) {
      throw new AppError('REFERRAL_TRANSITION_INVALID', {
        message: verdict.detail,
        details: { guard: verdict.code, state: current.state },
      });
    }

    const id = await referralRepo.insertReferral(trx, {
      fromHospitalId: actor.hospitalId,
      toHospitalId: input.toHospitalId,
      emergencyCaseId: current.id,
      requiredCapability: input.requiredCapability,
      requiredBedKind: input.requiredBedKind,
      summary: {
        problem: current.problem,
        triage: current.triage,
        ageYears: current.ageYears,
        sex: current.sex,
        note: input.note,
      },
      idempotencyKey: input.idempotencyKey,
      createdBy: actor.staffUserId,
    });
    return { id, duplicate: false };
  });

  const referral = await requiredReferral(filed.id);
  const serverTs = now();
  if (!filed.duplicate) {
    emit.referralIncoming(referral.to.hospitalId, { referral }, serverTs);
    emit.referralUpdated([referral.from.hospitalId], { referral }, serverTs);
  }
  return { referral, duplicate: filed.duplicate, serverTs };
}

// ---------------------------------------------------------------------------
// The receiving ER's steps (`LIST-B07-IN`, `FR-EMG-09`) and the sender's withdrawal
// ---------------------------------------------------------------------------

/** `POST /referrals/:id/seen` — somebody at the receiving ER looked. */
export async function seen(referralId: string, actor: ErActor): Promise<ReferralResult> {
  return await act(referralId, 'seen', {}, actor, async (trx) => {
    await referralRepo.writeReferral(trx, referralId, { state: 'seen', seen: true });
    return null;
  });
}

/** `POST /referrals/:id/accept` — "we will take them". */
export async function accept(referralId: string, actor: ErActor): Promise<ReferralResult> {
  return await act(referralId, 'accept', {}, actor, async (trx) => {
    await referralRepo.writeReferral(trx, referralId, {
      state: 'accepted',
      seen: true,
      respondedBy: actor.staffUserId,
    });
    return null;
  });
}

/** `POST /referrals/:id/decline` — with a reason (BACKEND.md §7.5). */
export async function decline(
  referralId: string,
  reason: string,
  actor: ErActor,
): Promise<ReferralResult> {
  return await act(referralId, 'decline', { reason }, actor, async (trx) => {
    await referralRepo.writeReferral(trx, referralId, {
      state: 'declined',
      seen: true,
      respondedBy: actor.staffUserId,
      declineReason: reason.trim(),
      closed: true,
    });
    return null;
  });
}

/** `POST /referrals/:id/cancel` — the sending ER withdraws, before arrival. */
export async function cancel(referralId: string, actor: ErActor): Promise<ReferralResult> {
  return await act(referralId, 'cancel', {}, actor, async (trx) => {
    await referralRepo.writeReferral(trx, referralId, { state: 'cancelled', closed: true });
    return null;
  });
}

/**
 * `POST /referrals/:id/arrive` — the person is at the receiving ER's door.
 * The handover, as the header describes it.
 */
export async function arrive(referralId: string, actor: ErActor): Promise<ReferralResult> {
  return await act(referralId, 'arrive', {}, actor, async (trx, current) => {
    // The sending ER's case leaves its triage list. The guards have held it in
    // the ER since the referral was sent; if it has somehow closed anyway, the
    // arrival is still a fact at this door and is recorded regardless.
    const senderCaseId = current.emergencyCaseId;
    const senderCase =
      senderCaseId === null ? null : await emergencyRepo.lockCase(trx, senderCaseId);
    if (senderCase !== null && canActOn(senderCase, 'refer').ok) {
      await emergencyRepo.writeCase(trx, senderCase.id, { state: 'referred', closed: true });
    }

    // A token at this ER, and a place on its triage list.
    const tokens = await emergencyRepo.tokenContext(trx, actor.hospitalId, today());
    const arrivedCaseId = await emergencyRepo.insertWalkIn(trx, {
      hospitalId: actor.hospitalId,
      problem: current.summary.problem,
      triage: current.summary.triage,
      tokenLabel: nextTokenLabel(tokens.arrivedToday, tokens.openLabels),
      phone: null,
      ageYears: current.summary.ageYears,
      sex: current.summary.sex,
      idempotencyKey: null,
      createdBy: actor.staffUserId,
    });

    await referralRepo.writeReferral(trx, referralId, {
      state: 'arrived',
      arrivedCaseId,
      closed: true,
    });
    return { cases: [arrivedCaseId, ...(senderCase === null ? [] : [senderCase.id])] };
  });
}

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

/** What a step changed beyond the referral, to broadcast after commit. */
type Changed = { readonly cases: readonly string[] } | null;

/** Steps 1–4 from the header, around one step's write. */
async function act(
  referralId: string,
  action: ReferralAction,
  context: { readonly reason?: string },
  actor: ErActor,
  write: (trx: Tx, current: ReferralView) => Promise<Changed>,
): Promise<ReferralResult> {
  const outcome = await withTransaction(async (trx) => {
    const current = await referralRepo.lockReferral(trx, referralId);
    if (current === null) throw notFound('referral');

    const side = sideOf(current, actor.hospitalId);
    if (side === null) throw forbiddenScope({ reason: 'wrong_hospital' });

    const verdict = canActOnReferral(current, action, side, context);
    if (!verdict.ok) {
      // The other side's step is refused however the referral stands: a
      // sending ER "accepting" its own referral is not a replay of anything.
      if (verdict.code === 'WRONG_SIDE') throw forbiddenScope({ reason: 'wrong_side' });
      if (referralAlreadyApplied(current, action)) return { changed: null, duplicate: true };
      throw new AppError('REFERRAL_TRANSITION_INVALID', {
        message: verdict.detail,
        details: { guard: verdict.code, state: current.state },
      });
    }

    return { changed: await write(trx, current), duplicate: false };
  });

  const referral = await requiredReferral(referralId);
  const serverTs = now();
  if (!outcome.duplicate) {
    // The cases first: a console that hears the referral arrive and then looks
    // for the person on its triage list should find them there.
    for (const caseId of outcome.changed?.cases ?? []) await emergency.publishCase(caseId);
    emit.referralUpdated(
      [referral.from.hospitalId, referral.to.hospitalId],
      { referral },
      serverTs,
    );
  }
  return { referral, duplicate: outcome.duplicate, serverTs };
}

async function requiredReferral(referralId: string): Promise<ReferralView> {
  const found = await referralRepo.findReferral(referralId);
  if (found === null) throw notFound('referral');
  return found;
}

function now(): Timestamp {
  return new Date().toISOString() as Timestamp;
}

function today(): ReturnType<typeof time.toDhakaDate> {
  return time.toDhakaDate(now());
}
