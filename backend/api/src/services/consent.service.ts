/**
 * Consent: how a patient lets a doctor look (`FR-PAT-63`, `FR-PAT-64`).
 *
 * ## The problem this solves
 *
 * A doctor in a chamber has no way to name the patient in front of them. The
 * console knows the booking it called, but a patient asking about records from
 * *another* hospital is not on today's roster anywhere. `FR-PAT-63` answers it
 * by having the patient present something: "a QR code presents the patient's
 * identity so a doctor console can open their history with consent".
 *
 * So the handshake is: the patient's screen asks for an **offer**, shows the
 * code it gets back, and the doctor's screen **redeems** it. Redeeming writes
 * the `consents` row and the `audit_log` row together — which is what makes
 * `FR-PAT-64`'s second half ("the patient can see who viewed their records and
 * when") answerable rather than aspirational.
 *
 * ## Why a code and not a picture
 *
 * `FR-PAT-63` says QR, and a QR is the right end state — it is faster and does
 * not depend on a patient reading digits aloud in a crowded chamber. Generating
 * one needs an encoder library and scanning one needs a camera pipeline, and
 * neither is installed (`CLAUDE.md` §7 requires asking first). The capability
 * is identical either way: a short-lived bearer string that names one patient.
 * Rendering it as a QR later changes `BTN-A12-QR` and `BTN-B05-SCAN` and
 * nothing here.
 *
 * ## Why the offer is signed rather than stored
 *
 * It lives for three minutes and is used once. A table for that would need a
 * row written, an index, and a sweep to delete what was never redeemed — for a
 * value whose whole lifetime is shorter than the sweep interval. A signed token
 * carries its own expiry and needs no cleanup, and the thing it protects is not
 * the token but the `consents` row that redeeming writes.
 */

import { CONSENT_OFFER_TTL_SECONDS } from '@platform/domain';

import { signToken, verifyToken } from '../config/jwt.js';
import { env } from '../env.js';
import { AppError, forbiddenScope, notFound } from '../errors/AppError.js';
import * as clinicalRepo from '../repositories/clinical.repo.js';
import { withTransaction } from '../repositories/transaction.js';

import type { Principal } from '../types/express.js';

/**
 * How long a granted consent lasts.
 *
 * `FR-PAT-64` requires consent to be revocable, not eternal, and nothing in the
 * documents fixes a duration. A day covers the visit it was granted for and the
 * follow-up reading a doctor does that evening, and expires on its own if the
 * patient never thinks about it again — which is the safer default than a grant
 * that outlives the reason for it.
 */
const CONSENT_TTL_HOURS = 24;

/** What the patient's screen shows on `BTN-A12-QR`. */
export interface ConsentOffer {
  /** The string the doctor pastes, and what a QR would encode. Long, because signed. */
  readonly code: string;
  readonly expiresInSeconds: number;
  /**
   * How long the grant lasts once a doctor redeems the code.
   *
   * Sent rather than written into the screen's copy, because `BTN-A12-QR` has
   * to show "consent scope and expiry" before the patient hands anything over,
   * and a figure duplicated in the client is a figure that drifts.
   */
  readonly grantHours: number;
}

/**
 * Mints an offer for the patient in front of the screen.
 *
 * The id in the path is checked against the caller's own credential, never
 * trusted on its own: an endpoint that minted an offer for any patient id would
 * be a way to grant yourself access to a stranger's record.
 */
export async function offerConsent(input: {
  readonly principal: Principal;
  readonly patientId: string;
}): Promise<ConsentOffer> {
  const patient = await clinicalRepo.findPatient(input.patientId);
  if (patient === null) throw notFound('patient');

  await assertSpeaksFor(input.principal, input.patientId);

  // `claims.kind` is `patient` because that is what the subject is; what makes
  // this a consent offer rather than a patient credential is the audience,
  // which is signed and checked on the way back in.
  const token = await signToken({
    kind: 'consent',
    claims: { sub: input.patientId, kind: 'patient' },
  });

  return {
    code: token,
    expiresInSeconds: CONSENT_OFFER_TTL_SECONDS,
    grantHours: CONSENT_TTL_HOURS,
  };
}

export interface RedeemedConsent {
  readonly consentId: string;
  readonly patientId: string;
  readonly patientName: string;
  readonly expiresAt: string;
}

/**
 * `POST /consents/qr` — the doctor's side of the handshake.
 *
 * Writes the grant and the audit row in one transaction. They are the same
 * fact: somebody was given access to a record, and a system that could record
 * one without the other would have a log that disagrees with its own
 * permissions.
 */
export async function redeemConsent(input: {
  readonly principal: Principal;
  readonly code: string;
}): Promise<RedeemedConsent> {
  if (input.principal.kind !== 'staff') throw forbiddenScope({ reason: 'staff_only' });
  if (!input.principal.roles.includes('doctor')) {
    throw forbiddenScope({ reason: 'role_not_permitted' });
  }

  const verified = await verifyToken(input.code, 'consent');
  if (!verified.ok) {
    // Expired, forged and never-real are one answer on purpose: a caller
    // guessing at codes must not learn which guess was closer.
    throw new AppError('CONSENT_CODE_INVALID', {
      message: 'That code has expired or is not valid.',
    });
  }

  const patientId = verified.claims.sub;
  const patient = await clinicalRepo.findPatient(patientId);
  if (patient === null) throw notFound('patient');

  const expiresAt = new Date(Date.now() + CONSENT_TTL_HOURS * 3_600_000).toISOString();
  const hospitalId = input.principal.hospitalId;
  const staffUserId = input.principal.id;

  const granted = await withTransaction(
    async (trx) =>
      await clinicalRepo.grantConsent(trx, {
        patientId,
        hospitalId,
        // Hospital-scoped rather than doctor-scoped, for the same reason
        // `FR-DOC-10` is: no column joins a console account to a `doctors` row.
        doctorId: null,
        scope: 'hospital',
        expiresAt,
        grantedVia: 'qr',
        staffUserId,
      }),
  );

  // The grant and the record of it being taken are one event.
  await clinicalRepo.recordRecordView({
    staffUserId,
    userId: null,
    hospitalId,
    patientId,
    subjectTable: 'consents',
    subjectId: granted.id,
    meta: { grantedVia: 'qr', reused: granted.reused, expiresAt },
  });

  return {
    consentId: granted.id,
    patientId,
    patientName: patient.fullName,
    expiresAt,
  };
}

/**
 * `POST /consents` — a patient grants a hospital access directly.
 *
 * The path that does not involve a chamber: a patient deciding in the app,
 * before or after a visit, that a hospital may read their history. The scope is
 * theirs to choose and the grant expires on its own like any other.
 */
export async function grantDirect(input: {
  readonly principal: Principal;
  readonly hospitalId: string;
  readonly scope: string;
}): Promise<{ consentId: string; expiresAt: string }> {
  if (input.principal.kind !== 'patient') throw forbiddenScope({ reason: 'patient_only' });

  const patientId = await primaryPatientOf(input.principal.id);
  const expiresAt = new Date(Date.now() + CONSENT_TTL_HOURS * 3_600_000).toISOString();

  const granted = await withTransaction(
    async (trx) =>
      await clinicalRepo.grantConsent(trx, {
        patientId,
        hospitalId: input.hospitalId,
        doctorId: null,
        scope: input.scope,
        expiresAt,
        grantedVia: 'app',
        staffUserId: null,
      }),
  );

  return { consentId: granted.id, expiresAt };
}

/** `POST /consents/:id/revoke` — `FR-PAT-64`, the half that makes it consent. */
export async function revokeConsent(input: {
  readonly principal: Principal;
  readonly consentId: string;
}): Promise<void> {
  const patientId = await clinicalRepo.findConsentPatient(input.consentId);

  // A consent that does not exist and one that belongs to somebody else are
  // the same answer: confirming an id exists is itself a disclosure.
  if (patientId === null) throw notFound('consent');

  await assertSpeaksFor(input.principal, patientId);

  const revoked = await clinicalRepo.revokeConsent(input.consentId, patientId);
  if (!revoked) throw notFound('consent');
}

/**
 * The profile a grant made by an account applies to.
 *
 * An account may hold several profiles (`FR-PAT-05`), and nothing in the
 * documents says which one a hospital-wide grant covers. Until `S-A-06`'s
 * profile switcher exists, the primary profile is the only defensible answer —
 * granting across all of somebody's family members on one tap would be a
 * larger permission than the screen asked for.
 */
async function primaryPatientOf(userId: string): Promise<string> {
  const patientId = await clinicalRepo.findPrimaryPatient(userId);
  if (patientId === null) throw notFound('patient');
  return patientId;
}

/** Every grant this patient has made (`BTN-A12-ACCESS`'s first half). */
export async function listConsents(input: {
  readonly principal: Principal;
  readonly patientId: string;
}): Promise<readonly clinicalRepo.ConsentRow[]> {
  await assertSpeaksFor(input.principal, input.patientId);
  return await clinicalRepo.listConsents(input.patientId);
}

/**
 * Who has looked, and when (`BTN-A12-ACCESS`, `FR-PAT-64`).
 *
 * Reading your own access log is not itself a patient-identifying read by
 * staff, so it writes no audit row. Logging it would grow the log every time
 * somebody checked the log, which makes the feature worse the more it is used.
 */
export async function accessLog(input: {
  readonly principal: Principal;
  readonly patientId: string;
}): Promise<readonly clinicalRepo.AccessEntry[]> {
  await assertSpeaksFor(input.principal, input.patientId);
  return await clinicalRepo.listAccessLog(input.patientId);
}

/**
 * Who may offer, list and revoke a patient's consent.
 *
 * **The patient, through their account.** That is the rule, and when Supabase
 * Auth lands it is the only branch left.
 *
 * **A guest, but only under `DEMO_MODE`, and only for the patient their own
 * booking names.** This version has no accounts (`CLAUDE.md` §4.1), so without
 * this branch the whole consent handshake is unreachable from the patient side
 * and `FR-PAT-63`/`FR-PAT-64` cannot be shown to anybody. It is the same kind
 * of affordance as the console picker handing out a staff principal without a
 * password, which §4.1 calls "the correct implementation for a pitch version".
 *
 * It is a real escalation and is gated as one. A tracking link already reaches
 * that booking's record (`FR-GST-08`); consent additionally gives a hospital
 * standing access to the patient's whole history, which is more than a
 * forwarded SMS should carry on a real deployment. With `DEMO_MODE` off a guest
 * is refused exactly as before, and when accounts exist this branch is deleted
 * rather than relaxed.
 *
 * The booking is the proof of subject: a link scoped to booking B names exactly
 * one patient, so this is not "a guest may consent for anyone" but "whoever
 * holds this booking's link may consent for the person it was booked for".
 */
async function assertSpeaksFor(principal: Principal, patientId: string): Promise<void> {
  switch (principal.kind) {
    case 'patient': {
      const owns = await clinicalRepo.patientBelongsToUser(patientId, principal.id);
      if (!owns) throw forbiddenScope({ reason: 'not_your_record' });
      return;
    }

    case 'guest': {
      if (!env.DEMO_MODE) throw forbiddenScope({ reason: 'patient_only' });
      if (principal.bookingId === null) throw forbiddenScope({ reason: 'link_has_no_booking' });

      const booking = await clinicalRepo.findChamberBooking(principal.bookingId);
      if (booking === null) throw notFound('booking');
      if (booking.patientId !== patientId) throw forbiddenScope({ reason: 'booking_patient' });
      return;
    }

    case 'staff':
      throw forbiddenScope({ reason: 'patient_only' });
  }
}
